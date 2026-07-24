import * as lark from "@larksuiteoapi/node-sdk";
import { chatWithKimi } from "./kimi.js";
import { SessionStore } from "./session.js";

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[config] missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const config = {
  appId: required("FEISHU_APP_ID"),
  appSecret: required("FEISHU_APP_SECRET"),
  kimiBaseUrl: process.env.KIMI_BASE_URL || "http://127.0.0.1:8765/v1",
  kimiApiKey: required("KIMI_API_KEY"),
  kimiModel: process.env.KIMI_MODEL || "kimi-k3",
  systemPrompt: process.env.BOT_SYSTEM_PROMPT || "你是飞书里的智能助手，简洁、准确地回答用户问题。",
};

const sessions = new SessionStore({ maxTurns: 12 });

const seenEventIds = new Set();
function alreadySeen(eventId) {
  if (!eventId) return false;
  if (seenEventIds.has(eventId)) return true;
  seenEventIds.add(eventId);
  if (seenEventIds.size > 5000) {
    const it = seenEventIds.values();
    for (let i = 0; i < 2500; i++) seenEventIds.delete(it.next().value);
  }
  return false;
}

const client = new lark.Client({
  appId: config.appId,
  appSecret: config.appSecret,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Feishu,
});

function extractText(message) {
  if (message?.message_type !== "text") return null;
  try {
    const content = JSON.parse(message.content);
    return (content.text ?? "").trim();
  } catch {
    return null;
  }
}

async function replyText(messageId, text) {
  await client.im.message.reply({
    path: { message_id: messageId },
    data: {
      msg_type: "text",
      content: JSON.stringify({ text }),
    },
  });
}

async function handleMessage(event) {
  const message = event?.message;
  if (!message) return;
  if (event?.sender?.sender_type === "bot") return;

  const chatId = message.chat_id;
  const text = extractText(message);

  if (text === null) {
    await replyText(message.message_id, "目前我只能处理文字消息，请发文字试试。");
    return;
  }

  if (text === "/clear" || text === "清空") {
    sessions.clear(chatId);
    await replyText(message.message_id, "已清空本会话的上下文。");
    return;
  }

  const history = sessions.get(chatId);

  let answer;
  try {
    answer = await chatWithKimi({
      baseUrl: config.kimiBaseUrl,
      apiKey: config.kimiApiKey,
      model: config.kimiModel,
      systemPrompt: config.systemPrompt,
      messages: [...history, { role: "user", content: text }],
    });
  } catch (err) {
    console.error("[kimi]", err);
    await replyText(message.message_id, `调用模型出错了：${err.message}`);
    return;
  }

  sessions.append(chatId, text, answer);
  await replyText(message.message_id, answer);
}

const eventDispatcher = new lark.EventDispatcher({}).register({
  "im.message.receive_v1": async (data) => {
    const eventId = data?.event_id ?? data?.event?.event_id;
    if (alreadySeen(eventId)) return;
    await handleMessage(data?.event ?? data);
  },
});

async function main() {
  console.log("[bot] starting...");
  console.log(`[bot] appId=${config.appId} model=${config.kimiModel} via ${config.kimiBaseUrl}`);

  const wsClient = new lark.WSClient({
    appId: config.appId,
    appSecret: config.appSecret,
    domain: lark.Domain.Feishu,
    loggerLevel: lark.LoggerLevel.info,
  });

  await wsClient.start({ eventDispatcher });
  console.log("[bot] WebSocket connected, waiting for messages...");
}

main().catch((err) => {
  console.error("[bot] fatal:", err);
  process.exit(1);
});
