// Load .env manually (no dependency).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith("#")) process.env[m[1]] = m[2];
  }
}

import * as lark from "@larksuiteoapi/node-sdk";
import { SessionStore } from "./session.js";
import { buildStreamCard, buildFinalCard, buildAgentCard } from "./card.js";
import { isAdmin, ADMIN_OPEN_ID } from "./admin.js";
import { classifyRisk } from "./risk.js";
import { State } from "./state.js";
import { ApprovalManager } from "./approvals.js";
import { helpText, parseCommand } from "./commands.js";
import { runAgent } from "./agent.js";
import { tokenTracker } from "./tokens.js";
import { downloadImageBase64, downloadImageBuffer, replyImageBuffer } from "./image.js";
import { restoreImageBuffer, DEFAULT_RESTORE_PROMPT, isImageRestoreConfigured } from "./image-restore.js";

function required(name) {
  const v = process.env[name];
  if (!v) { console.error("[config] missing " + name); process.exit(1); }
  return v;
}

const config = {
  appId: required("FEISHU_APP_ID"),
  appSecret: required("FEISHU_APP_SECRET"),
  kimiBaseUrl: process.env.KIMI_BASE_URL || "http://127.0.0.1:8765/v1",
  kimiApiKey: required("KIMI_API_KEY"),
  kimiModel: process.env.KIMI_MODEL || "kimi-k3",
  systemPrompt: process.env.BOT_SYSTEM_PROMPT || "你是飞书里的智能助手，可以调用工具在本地工作区完成任务。",
  flushIntervalMs: Number(process.env.FLUSH_INTERVAL_MS || 800),
};

const runtime = { model: config.kimiModel };
const sessions = new SessionStore({ maxTurns: 12 });
const chatTokens = new Map(); // chatId -> { prompt, completion, total }
function addChatTokens(chatId, usage) {
  if (!usage) return;
  const t = chatTokens.get(chatId) ?? { prompt: 0, completion: 0, total: 0 };
  t.prompt += usage.prompt ?? 0;
  t.completion += usage.completion ?? 0;
  t.total += usage.total ?? 0;
  chatTokens.set(chatId, t);
}
const state = new State();
const activeGenerations = new Map();

const seenEventIds = new Set();
function alreadySeen(id) {
  if (!id) return false;
  if (seenEventIds.has(id)) return true;
  seenEventIds.add(id);
  if (seenEventIds.size > 5000) { const it = seenEventIds.values(); for (let i=0;i<2500;i++) seenEventIds.delete(it.next().value); }
  return false;
}

const client = new lark.Client({
  appId: config.appId, appSecret: config.appSecret,
  appType: lark.AppType.SelfBuild, domain: lark.Domain.Feishu,
});

const approvals = new ApprovalManager({ client, state, adminOpenId: ADMIN_OPEN_ID });

function extractMessage(message) {
  const type = message?.message_type;
  const images = [];
  try {
    const content = JSON.parse(message.content);
    const stripMentions = (t) => {
      for (const m of message.mentions ?? []) { if (m.key) t = t.replace(m.key, "").trim(); }
      return t;
    };
    if (type === "text") {
      return { text: stripMentions((content.text ?? "").trim()), images };
    }
    if (type === "post") {
      const parts = [];
      const blocks = content.content ?? content.content_v2 ?? [];
      for (const line of blocks) {
        for (const seg of line) {
          if (seg.tag === "text") parts.push(seg.text ?? "");
          else if (seg.tag === "a") parts.push(seg.text ?? seg.href ?? "");
          else if (seg.tag === "img") { parts.push("[图片]"); if (seg.image_key) images.push(seg.image_key); }
          else if (seg.tag === "media") parts.push("[视频]");
          else if (seg.tag === "emotion") parts.push("[表情]");
        }
        parts.push("\n");
      }
      return { text: stripMentions(parts.join("").trim()) || null, images };
    }
    if (type === "image") { if (content.image_key) images.push(content.image_key); return { text: "[图片]", images }; }
    if (type === "file") return { text: "[文件] " + (content.file_name ?? ""), images };
    if (type === "audio") return { text: "[语音]", images };
    if (type === "sticker") return { text: "[表情]", images };
    return { text: null, images };
  } catch { return { text: null, images }; }
}

async function replyText(messageId, text) {
  await client.im.message.reply({
    path: { message_id: messageId },
    data: { msg_type: "text", content: JSON.stringify({ text }) },
  });
}

async function sendTextToChat(chatId, text) {
  await client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: { receive_id: chatId, msg_type: "text", content: JSON.stringify({ text }) },
  });
}

function shouldAutoRestoreImage(text) {
  const t = String(text || "");
  return /(修复|修图|清晰化|变清晰|老照片|高清化|超分|放大|去噪|去模糊|划痕|上色)/.test(t);
}

async function handleImageRepair({ message, chatId, text, images, signal }) {
  const prompt = DEFAULT_RESTORE_PROMPT + (text && text !== "[图片]" ? "\n用户补充要求：" + text : "");
  if (!isImageRestoreConfigured()) {
    await replyText(
      message.message_id,
      "图片链路已接好，但修复服务未配置。请在 feishu-kimi-bot/.env 配置 IMAGE_EDIT_WEBHOOK_URL（或 IMAGE_EDIT_BASE_URL/IMAGE_EDIT_API_KEY/IMAGE_EDIT_MODEL）后重启机器人。"
    );
    return;
  }
  await replyText(message.message_id, "收到，开始修复并回传图片…");
  const first = images[0];
  const { buf, mime } = await downloadImageBuffer({
    appId: config.appId,
    appSecret: config.appSecret,
    messageId: message.message_id,
    fileKey: first,
  });
  const out = await restoreImageBuffer({ inputBuffer: buf, inputMime: mime, prompt, signal });
  await replyImageBuffer({ client, messageId: message.message_id, buffer: out.buf });
}

async function replyCard(messageId, card) {
  const res = await client.im.message.reply({
    path: { message_id: messageId },
    data: { msg_type: "interactive", content: JSON.stringify(card) },
  });
  return (res?.data ?? res)?.message_id;
}

async function updateCard(cardMessageId, card) {
  await client.im.message.patch({
    path: { message_id: cardMessageId },
    data: { content: JSON.stringify(card) },
  });
}

const chatLocks = new Map();
async function withLock(key, fn) {
  const prev = chatLocks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  chatLocks.set(key, next.catch(() => {}));
  return next;
}

// Run the agent and render progress live into a card.
// Feishu rejects too-frequent updates to a single message (error 230020),
// so card updates are serialized, throttled to one per minInterval,
// coalesced while dirty, and backed off after failures.
async function runAgentWithCard({ messageId, chatId, history, userText, images = [], message, openId, admin, signal }) {
  const events = [];
  let cardMessageId = null;
  let finalText = "";

  const minInterval = Math.max(config.flushIntervalMs, 1000);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let lastFlush = 0;   // time of last successful card update
  let backoffMs = 0;   // extra wait after a failed (rate-limited) update
  let dirty = false;   // events changed since last successful render
  let pumping = false; // an update loop is running

  const tryUpdate = async (streaming) => {
    try {
      await updateCard(cardMessageId, buildAgentCard(events, { streaming }));
      lastFlush = Date.now();
      backoffMs = 0;
      return true;
    } catch (e) {
      console.error("[render]", e.message);
      backoffMs = Math.min((backoffMs || 1500) * 2, 15000);
      return false;
    }
  };

  // Drain pending renders sequentially; at most one loop runs at a time.
  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      while (dirty && !signal?.aborted) {
        dirty = false;
        const wait = lastFlush + minInterval + backoffMs - Date.now();
        if (wait > 0) await sleep(wait);
        if (!(await tryUpdate(true))) dirty = true; // retry after backoff
      }
    } finally {
      pumping = false;
    }
  };

  // Called by the agent loop without await; just mark dirty and kick the pump.
  const onEvent = (ev) => {
    events.push(ev);
    dirty = true;
    void pump();
  };

  // Final render: wait for the pump to settle, then update with retries.
  const flushFinal = async (streaming) => {
    dirty = false;
    while (pumping) await sleep(100);
    if (!cardMessageId) return false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const wait = lastFlush + minInterval + backoffMs - Date.now();
      if (wait > 0) await sleep(wait);
      if (await tryUpdate(streaming)) return true;
    }
    return false;
  };

  try {
    cardMessageId = await replyCard(messageId, buildAgentCard(events, { streaming: true }));
    lastFlush = Date.now();

    // Build multimodal content if the message has images.
    let userContent = userText;
    if (images.length) {
      userContent = [{ type: "text", text: userText || "请分析这张图片" }];
      for (const key of images.slice(0, 10)) {
        try {
          const dataUrl = await downloadImageBase64({
            appId: config.appId, appSecret: config.appSecret,
            messageId: message.message_id, fileKey: key,
          });
          userContent.push({ type: "image_url", image_url: { url: dataUrl } });
          events.push({ type: "tool_result", name: "image", ok: true, result: { content: "image" } });
        } catch (e) {
          events.push({ type: "tool_result", name: "image", ok: false, result: { error: "图片下载失败: " + e.message } });
        }
      }
    }

    const result = await runAgent({
      baseUrl: config.kimiBaseUrl,
      apiKey: config.kimiApiKey,
      model: runtime.model,
      systemPrompt: config.systemPrompt,
      userText,
      userContent,
      history,
      signal,
      isAdminUser: admin,
      onEvent,
      requestApproval: async ({ toolName, toolArgs, description }) => {
        return approvals.requestApproval({
          requesterOpenId: openId,
          requesterName: openId,
          chatId,
          toolName,
          toolArgs,
          text: description,
          risk: { reasons: ["tool:" + toolName] },
        });
      },
    });
    finalText = result.text || "";
    addChatTokens(chatId, result.usage);
    events.push({ type: "answer", text: finalText });
    await flushFinal(false);
    if (finalText) sessions.append(chatId, userText, finalText);
  } catch (err) {
    const aborted = signal?.aborted || err?.name === "AbortError";
    events.push({ type: "answer", text: aborted ? "\n\n_（已停止）_" : "出错了：" + err.message });
    if (!(await flushFinal(false))) {
      try { await replyText(messageId, aborted ? "已停止。" : "出错了：" + err.message); } catch {}
    }
  }
}

async function handleCommand({ message, text, openId, admin }) {
  const parsed = parseCommand(text);
  if (!parsed) return false;
  const { cmd, args } = parsed;
  const chatId = message.chat_id;
  const chatType = message.chat_type;

  switch (cmd) {
    case "/help": await replyText(message.message_id, helpText(admin)); return true;
    case "/whoami": await replyText(message.message_id, "open_id: " + openId + "\n身份：" + (admin ? "管理员" : "普通用户")); return true;
    case "/tokens": await replyText(message.message_id, tokenTracker.report()); return true;
    case "/new": case "/clear": sessions.clear(chatId); chatTokens.delete(chatId); await replyText(message.message_id, "已开始新对话，上下文和 token 计数已清空。"); return true;
    case "/stop": {
      const c = activeGenerations.get(chatId);
      if (c) { c.abort(); activeGenerations.delete(chatId); await replyText(message.message_id, "已停止当前生成。"); }
      else await replyText(message.message_id, "当前没有正在生成的回复。");
      return true;
    }
    case "/token": {
      const t = chatTokens.get(chatId) ?? { prompt: 0, completion: 0, total: 0 };
      await replyText(message.message_id, "本会话累计 token：\n输入: " + t.prompt + "\n输出: " + t.completion + "\n总计: " + t.total);
      return true;
    }
    case "/mode": await replyText(message.message_id, "Agent 模式\n当前模型：" + runtime.model + "\n群聊授权：" + (state.isChatInvited(chatId) ? "已授权" : "未授权")); return true;
    case "/model": {
      if (!admin) { await replyText(message.message_id, "只有管理员可以切换模型。"); return true; }
      if (!args.length) await replyText(message.message_id, "当前模型：" + runtime.model);
      else { runtime.model = args[0]; await replyText(message.message_id, "已切换模型为：" + runtime.model); }
      return true;
    }
    case "/invite": {
      if (!admin) { await replyText(message.message_id, "只有管理员可以授权群聊。"); return true; }
      if (chatType !== "group" && chatType !== "topic") { await replyText(message.message_id, "请在需要授权的群聊里发送 /invite。"); return true; }
      state.inviteChat(chatId);
      await replyText(message.message_id, "已授权本群。/uninvite 可取消。");
      return true;
    }
    case "/uninvite": {
      if (!admin) { await replyText(message.message_id, "只有管理员可以操作。"); return true; }
      state.uninviteChat(chatId);
      await replyText(message.message_id, "已取消本群授权。");
      return true;
    }
    case "/pending": {
      if (!admin) { await replyText(message.message_id, "只有管理员可以查看审批。"); return true; }
      const list = state.pendingApprovals();
      if (!list.length) await replyText(message.message_id, "当前没有待审批的请求。");
      else await replyText(message.message_id, "待审批：\n" + list.map(a => "#" + a.id + " — " + (a.requesterName || a.requesterOpenId) + ": " + (a.text || a.toolName || "").slice(0, 60)).join("\n"));
      return true;
    }
    case "/approve": case "/reject": {
      if (!admin) { await replyText(message.message_id, "只有管理员可以审批。"); return true; }
      const id = Number(args[0]);
      if (!id) { await replyText(message.message_id, "用法：" + cmd + " <id>"); return true; }
      const ok = approvals.resolve(id, cmd === "/approve");
      await replyText(message.message_id, ok ? ("已" + (cmd === "/approve" ? "同意" : "拒绝") + "审批 #" + id + "。") : ("审批 #" + id + " 不存在或已处理。"));
      return true;
    }
    default: await replyText(message.message_id, "未知命令 " + cmd + "，发送 /help 查看。"); return true;
  }
}

function botWasMentioned(event) {
  const mentions = event?.message?.mentions ?? [];
  if (!mentions.length) return false;
  const content = event?.message?.content ?? "";
  return mentions.some((m) => m.key && content.includes(m.key));
}

async function handleMessage(event) {
  try {
    fs.appendFileSync("events.log", JSON.stringify({
      t: new Date().toISOString(),
      chat_type: event?.message?.chat_type,
      content: event?.message?.content,
      sender: event?.sender?.sender_id?.open_id,
    }) + "\n");
  } catch {}

  console.log("[msg]", event?.message?.chat_type, (event?.message?.content || "").slice(0, 50));
  const message = event?.message;
  if (!message) return;
  if (event?.sender?.sender_type === "bot") return;

  const openId = event?.sender?.sender_id?.open_id;
  const chatId = message.chat_id;
  const chatType = message.chat_type;
  const { text, images } = extractMessage(message);
  const admin = isAdmin(openId);

  if (text === null) { await replyText(message.message_id, "目前我只能处理文字消息。"); return; }

  const isGroup = chatType === "group" || chatType === "topic";
  const mentioned = botWasMentioned(event);
  const isCmd = text.startsWith("/");

  if (isGroup) {
    // In group chats, only respond when the bot is @-mentioned.
    // (Admin commands like /invite still work without mention.)
    if (!(mentioned || (admin && isCmd))) return;
  }

  // /stop must run immediately, NOT queued behind the chat lock.
  if (isCmd && text.split(/\s+/)[0].toLowerCase() === "/stop") {
    const c = activeGenerations.get(chatId);
    if (c) { c.abort(); activeGenerations.delete(chatId); await replyText(message.message_id, "已停止当前生成。"); }
    else await replyText(message.message_id, "当前没有正在生成的回复。");
    return;
  }

  if (isCmd) {
    const handled = await handleCommand({ message, text, openId, admin });
    if (handled) return;
  }

  // Deterministic image repair path: if the user sent an image and asked to
  // repair/restore it, download -> restore -> upload -> reply without waiting
  // for the text-only LLM loop.
  if (images.length && shouldAutoRestoreImage(text)) {
    const controller = new AbortController();
    activeGenerations.set(chatId, controller);
    try {
      await withLock(chatId, () =>
        handleImageRepair({ message, chatId, text, images, signal: controller.signal })
      );
    } finally {
      activeGenerations.delete(chatId);
    }
    return;
  }

  // Text-level risk gate for non-admin (in addition to tool-level gate).
  const risk = classifyRisk(text);
  if (!admin && risk.level === "high" && !mentioned) {
    await replyText(message.message_id, "这个请求涉及高风险操作，已提交给管理员审批。");
    const decision = await approvals.requestApproval({
      requesterOpenId: openId, requesterName: openId, chatId, text, risk,
    });
    if (!decision.approved) {
      await sendTextToChat(chatId, (decision.reason === "timeout" ? "审批超时" : "管理员已拒绝") + "，无法执行。");
      return;
    }
    await sendTextToChat(chatId, "管理员已同意，开始处理。");
  }

  const history = sessions.get(chatId);
  const controller = new AbortController();
  activeGenerations.set(chatId, controller);
  try {
    await withLock(chatId, () =>
      runAgentWithCard({ messageId: message.message_id, chatId, history, userText: text, images, message, openId, admin, signal: controller.signal })
    );
  } finally {
    activeGenerations.delete(chatId);
  }
}

async function handleCardAction(event) {
  const operator = event?.operator?.open_id;
  const value = event?.action?.value ?? {};
  if (!isAdmin(operator)) return { toast: { type: "warning", content: "只有管理员可以操作" } };
  const ok = approvals.resolve(Number(value.approval_id), value.action === "approve");
  return { toast: { type: ok ? "success" : "info", content: ok ? ("已" + (value.action === "approve" ? "同意" : "拒绝") + " #" + value.approval_id) : "该审批已处理" } };
}

const eventDispatcher = new lark.EventDispatcher({}).register({
  "im.message.receive_v1": async (data) => {
    try {
      const eventId = data?.event_id ?? data?.event?.event_id;
      if (alreadySeen(eventId)) return;
      await handleMessage(data?.event ?? data);
    } catch (e) {
      console.error("[handler-error]", e && e.stack || e);
    }
  },
  "card.action.trigger": async (data) => handleCardAction(data?.event ?? data),
});

process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e && e.stack || e));
process.on("uncaughtException", (e) => console.error("[uncaughtException]", e && e.stack || e));

async function main() {
  console.log("[bot] AGENT mode, admin=" + ADMIN_OPEN_ID);
  console.log("[bot] appId=" + config.appId + " model=" + runtime.model + " via " + config.kimiBaseUrl);
  const wsClient = new lark.WSClient({
    appId: config.appId, appSecret: config.appSecret,
    domain: lark.Domain.Feishu, loggerLevel: lark.LoggerLevel.info,
  });
  await wsClient.start({ eventDispatcher });
  console.log("[bot] WebSocket connected, waiting for messages...");
}

main().catch((err) => { console.error("[bot] fatal:", err); process.exit(1); });
