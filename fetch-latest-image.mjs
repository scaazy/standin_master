// Fetch the most recent image message across the bot's chats and save locally.
import fs from "node:fs";

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const outPath = process.argv[2] || "input.jpg";
const BASE = "https://open.feishu.cn/open-apis";

async function getToken() {
  const resp = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const data = await resp.json();
  if (!data.tenant_access_token) throw new Error("token failed: " + JSON.stringify(data));
  return data.tenant_access_token;
}

const token = await getToken();
const auth = { Authorization: `Bearer ${token}` };

async function api(path) {
  const resp = await fetch(`${BASE}${path}`, { headers: auth });
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`API ${path} failed: ` + JSON.stringify(data).slice(0, 300));
  return data.data;
}

const chats = await api("/im/v1/chats?page_size=50");
let latest = null;
for (const chat of chats.items || []) {
  try {
    const msgs = await api(`/im/v1/messages?container_id_type=chat&container_id=${chat.chat_id}&page_size=20&sort_type=ByCreateTimeDesc`);
    for (const m of msgs.items || []) {
      if (m.msg_type !== "image") continue;
      if (!latest || BigInt(m.create_time) > BigInt(latest.create_time)) {
        let key = null;
        try { key = JSON.parse(m.body?.content || "{}").image_key; } catch {}
        if (key) latest = { messageId: m.message_id, fileKey: key, chatId: chat.chat_id, create_time: m.create_time, p2p: chat.chat_mode === "p2p" };
      }
    }
  } catch (e) { console.log("list msgs failed for", chat.chat_id, e.message.slice(0, 120)); }
}
if (!latest) throw new Error("no image message found");
console.log("LATEST:", JSON.stringify(latest));

const resp = await fetch(`${BASE}/im/v1/messages/${latest.messageId}/resources/${latest.fileKey}?type=image`, { headers: auth });
if (!resp.ok) throw new Error("download failed HTTP " + resp.status + ": " + (await resp.text()).slice(0, 300));
const buf = Buffer.from(await resp.arrayBuffer());
fs.writeFileSync(outPath, buf);
console.log(JSON.stringify({ ok: true, bytes: buf.length, outPath }));
fs.writeFileSync("last-image-msg.json", JSON.stringify(latest, null, 2));
