// OpenAI-compatible streaming chat client for the local Kimi proxy.

export async function* chatWithKimiStream({ baseUrl, apiKey, model, systemPrompt, messages, signal }) {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const body = {
    model,
    messages: [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...messages,
    ],
    stream: true,
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Kimi request failed: HTTP ${resp.status} ${text.slice(0, 300)}`);
  }
  if (!resp.body) throw new Error("Kimi response has no body to stream");

  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of resp.body) {
    if (signal?.aborted) return;
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const json = JSON.parse(payload);
        const delta = json?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) yield delta;
      } catch {
        // skip malformed SSE chunk
      }
    }
  }
}

export async function chatWithKimi(args) {
  let full = "";
  for await (const delta of chatWithKimiStream(args)) full += delta;
  if (!full) throw new Error("Kimi returned empty content");
  return full;
}
