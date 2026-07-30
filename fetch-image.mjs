// Download an image from Feishu by image_key and save locally.
import fs from "node:fs";

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const imageKey = process.argv[2];
const outPath = process.argv[3] || "input.jpg";

async function getToken() {
  const resp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const data = await resp.json();
  if (!data.tenant_access_token) throw new Error("token failed: " + JSON.stringify(data));
  return data.tenant_access_token;
}

const token = await getToken();
const resp = await fetch(`https://open.feishu.cn/open-apis/im/v1/images/${imageKey}`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!resp.ok) {
  const text = await resp.text();
  throw new Error(`download failed HTTP ${resp.status}: ${text.slice(0, 300)}`);
}
const buf = Buffer.from(await resp.arrayBuffer());
fs.writeFileSync(outPath, buf);
console.log(JSON.stringify({ ok: true, bytes: buf.length, contentType: resp.headers.get("content-type"), outPath }));
