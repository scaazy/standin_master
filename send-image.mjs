// Upload a local image to Feishu and send it to a user/chat.
// Usage:
//   node send-image.mjs <image-path> <receive-id> [open_id|chat_id]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2];
    }
  }
}

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
if (!APP_ID || !APP_SECRET) throw new Error("missing FEISHU_APP_ID / FEISHU_APP_SECRET in .env");

const filePath = process.argv[2] || "restored.jpg";
const receiveId = process.argv[3];
const receiveIdType = process.argv[4] || "open_id";
if (!receiveId) throw new Error("usage: node send-image.mjs <image-path> <receive-id> [open_id|chat_id]");
if (!fs.existsSync(filePath)) throw new Error("image not found: " + filePath);

const BASE = "https://open.feishu.cn/open-apis";

async function api(url, options = {}) {
  const resp = await fetch(url, options);
  const data = await resp.json().catch(async () => ({ httpStatus: resp.status, raw: await resp.text().catch(() => "") }));
  if (!resp.ok || data.code !== 0) {
    throw new Error(`${url} failed: HTTP ${resp.status} ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}

async function getToken() {
  const data = await api(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  return data.tenant_access_token;
}

function mimeFromPath(p) {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

const token = await getToken();
const auth = { Authorization: `Bearer ${token}` };
const buf = fs.readFileSync(filePath);
const mime = mimeFromPath(filePath);

// 1. Upload image.
const form = new FormData();
form.append("image_type", "message");
form.append("image", new Blob([buf], { type: mime }), path.basename(filePath));
const upData = await api(`${BASE}/im/v1/images`, { method: "POST", headers: auth, body: form });
const imageKey = upData.data.image_key;
console.log("uploaded image_key:", imageKey);

// 2. Send image message.
const sendData = await api(`${BASE}/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({
    receive_id: receiveId,
    msg_type: "image",
    content: JSON.stringify({ image_key: imageKey }),
  }),
});
console.log("sent message_id:", sendData.data.message_id);
