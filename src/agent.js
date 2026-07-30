// Agent loop: Kimi with function-calling, executing tools locally.

import { chatWithKimiStream } from "./kimi.js";
import { TOOL_DEFS, TOOL_RISK, dispatchTool } from "./tools.js";
import { tokenTracker } from "./tokens.js";

// Retry wrapper for unstable API.
async function withRetry(fn, { retries = 3, baseDelayMs = 1500 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (e?.name === "AbortError") throw e;
      if (attempt < retries) {
        const wait = baseDelayMs * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

// A non-streaming call that returns { message, usage }.
async function callKimiOnce({ baseUrl, apiKey, model, systemPrompt, messages, signal }) {
  const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const body = {
    model,
    messages: [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...messages,
    ],
    tools: TOOL_DEFS,
    tool_choice: "auto",
    stream: false,
  };
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error("Kimi HTTP " + resp.status + " " + t.slice(0, 300));
  }
  const data = await resp.json();
  return { message: data.choices?.[0]?.message ?? {}, usage: data.usage ?? null };
}

// Run the agent. onEvent({type, ...}) reports progress for live card updates.
// Returns final assistant text.
export async function runAgent(opts) {
  const {
    baseUrl, apiKey, model, systemPrompt, userText, history = [],
    signal, onEvent, isAdminUser, requestApproval,
    maxSteps = Number(process.env.AGENT_MAX_STEPS || 20),
  } = opts;

  const userContent = opts.userContent ?? userText;
  const totalUsage = { prompt: 0, completion: 0, total: 0 };
  const messages = [...history, { role: "user", content: userContent }];

  for (let step = 0; step < maxSteps; step++) {
    if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });

    onEvent?.({ type: "thinking", step });
    const { message: msg, usage } = await withRetry(
      () => callKimiOnce({ baseUrl, apiKey, model, systemPrompt, messages, signal }),
      { retries: 3 }
    );
    if (usage) {
      tokenTracker.record(usage);
      totalUsage.prompt += usage.prompt_tokens ?? 0;
      totalUsage.completion += usage.completion_tokens ?? 0;
      totalUsage.total += usage.total_tokens ?? 0;
      onEvent?.({ type: "usage", usage, cumulative: { ...totalUsage } });
    }
    messages.push(msg);

    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) {
      // Final answer (no tools needed).
      return { text: msg.content || "", messages, usage: totalUsage };
    }

    // Execute each requested tool.
    for (const tc of toolCalls) {
      const name = tc.function?.name;
      let args = {};
      try { args = JSON.parse(tc.function?.arguments || "{}"); } catch {}
      const risk = TOOL_RISK[name] ?? "high";

      onEvent?.({ type: "tool_call", name, args, risk });

      // High-risk tool from non-admin requires approval.
      if (risk === "high" && !isAdminUser) {
        onEvent?.({ type: "tool_pending", name, args });
        const decision = await requestApproval({
          toolName: name,
          toolArgs: args,
          description: describeTool(name, args),
        });
        if (!decision.approved) {
          const denyText = "管理员拒绝了 " + name + " 操作";
          onEvent?.({ type: "tool_denied", name });
          messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ ok: false, error: denyText }) });
          continue;
        }
      }

      onEvent?.({ type: "tool_running", name, args });
      let result;
      try {
        result = await dispatchTool(name, args);
      } catch (e) {
        result = { ok: false, error: e.message };
      }
      onEvent?.({ type: "tool_result", name, ok: result.ok !== false, result });

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result).slice(0, 12000),
      });
    }
  }

  return { text: "已达到最大执行步数，任务未完成。", messages, usage: totalUsage };
}

function describeTool(name, args) {
  switch (name) {
    case "write_file": return "写入文件: " + (args?.path ?? "");
    case "run_command": return "执行命令: " + (args?.command ?? "");
    case "install_skill": return "安装 skill: " + (args?.name_or_repo ?? "");
    default: return name + " " + JSON.stringify(args ?? {});
  }
}
