import * as lark from "@larksuiteoapi/node-sdk";

export function buildStreamCard(text, opts) {
  const streaming = !opts || opts.streaming !== false;
  return {
    schema: "2.0",
    config: { update_multi: true, streaming_mode: streaming },
    header: { title: { tag: "plain_text", content: "Kimi" }, template: "blue" },
    body: { elements: [{ tag: "markdown", element_id: "answer", content: text }] },
  };
}

export function buildFinalCard(text) {
  return buildStreamCard(text, { streaming: false });
}

// Render the agent's live transcript (thinking + tool calls + answer) as a card.
export function buildAgentCard(events, opts) {
  const streaming = !opts || opts.streaming !== false;
  const lines = [];
  for (const ev of events) {
    switch (ev.type) {
      case "thinking":
        lines.push("🤔 _思考中..._");
        break;
      case "tool_call":
        lines.push("🔧 **" + ev.name + "** " + "\`" + truncate(JSON.stringify(ev.args), 80) + "\`");
        break;
      case "tool_pending":
        lines.push("   ⏳ _等待管理员审批..._");
        break;
      case "tool_running":
        lines.push("   ⏳ _执行中..._");
        break;
      case "tool_result": {
        const icon = ev.ok ? "✅" : "❌";
        lines.push("   " + icon + " " + resultSummary(ev));
        break;
      }
      case "tool_denied":
        lines.push("   🚫 _已被管理员拒绝_");
        break;
      case "answer":
        lines.push("\n---\n" + ev.text);
        break;
      default:
        break;
    }
  }
  // Collapse consecutive "thinking" entries to only the latest.
  const collapsed = [];
  for (const l of lines) {
    if (l.startsWith("🤔") && collapsed.length && collapsed[collapsed.length - 1].startsWith("🤔")) {
      collapsed[collapsed.length - 1] = l;
    } else {
      collapsed.push(l);
    }
  }
  // Token usage footer: sum all usage events for this run.
  let prompt = 0, completion = 0, total = 0, calls = 0;
  for (const ev of events) {
    if (ev.type === "usage" && ev.usage) {
      prompt += Number(ev.usage.prompt_tokens ?? 0);
      completion += Number(ev.usage.completion_tokens ?? 0);
      total += Number(ev.usage.total_tokens ?? 0);
      calls++;
    }
  }
  if (calls > 0) {
    collapsed.push(
      "\n📊 _本次消耗 " + total.toLocaleString() + " tokens" +
      "（输入 " + prompt.toLocaleString() + " + 输出 " + completion.toLocaleString() + "）_"
    );
  }
  return {
    schema: "2.0",
    config: { update_multi: true, streaming_mode: streaming },
    header: { title: { tag: "plain_text", content: "Kimi Agent" }, template: "blue" },
    body: { elements: [{ tag: "markdown", element_id: "answer", content: collapsed.join("\n") || "..." }] },
  };
}

function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function resultSummary(ev) {
  const r = ev.result ?? {};
  if (r.error) return "\`" + truncate(r.error, 100) + "\`";
  if (r.path) return "\`" + r.path + "\`" + (r.bytes ? " (" + r.bytes + " bytes)" : "");
  if (r.installed) return "已安装到 \`" + r.installed + "\`";
  if (r.stdout !== undefined) return "\`" + truncate((r.stdout || "(无输出)").trim(), 120) + "\`";
  if (r.content !== undefined) return "读取 " + (r.content.length) + " 字符";
  if (r.entries) return r.entries.length + " 项";
  if (r.results) return r.results.length + " 个匹配";
  return "完成";
}

export function buildApprovalCard(approval) {
  const riskList = (approval.risk?.reasons ?? []).map((r) => "- " + r).join("\n") || "- (规则命中)";
  const toolDesc = approval.toolName
    ? "**工具**：" + approval.toolName + "\n**参数**：\`\`\`" + JSON.stringify(approval.toolArgs, null, 2).slice(0, 500) + "\`\`\`"
    : "**请求内容**：\n" + (approval.text ?? "");
  return {
    schema: "2.0",
    config: { update_multi: true },
    header: { title: { tag: "plain_text", content: "高风险操作审批 #" + approval.id }, template: "orange" },
    body: {
      elements: [
        {
          tag: "markdown",
          content: [
            "**申请人**：" + (approval.requesterName || approval.requesterOpenId),
            "**open_id**：\`" + approval.requesterOpenId + "\`",
            "",
            toolDesc,
            "",
            "**命中风险规则**：",
            riskList,
          ].join("\n"),
        },
        {
          tag: "action",
          actions: [
            { tag: "button", text: { tag: "plain_text", content: "同意" }, type: "primary", value: { action: "approve", approval_id: approval.id } },
            { tag: "button", text: { tag: "plain_text", content: "拒绝" }, type: "danger", value: { action: "reject", approval_id: approval.id } },
          ],
        },
        { tag: "markdown", content: "也可回复 \`/approve " + approval.id + "\` 或 \`/reject " + approval.id + "\`" },
      ],
    },
  };
}
