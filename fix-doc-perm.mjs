// 诊断并修复文档权限：1) 查当前协作者 2) 查公开分享设置 3) 重新授权群 4) 开启"组织内获得链接可查看"
import fs from "node:fs";

// 手动加载 .env（处理 BOM）
const envText = fs.readFileSync(new URL("./.env", import.meta.url), "utf8").replace(/^﻿/, "");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const DOC_TOKEN = process.argv[2] || "QvzWdz1VpoBqHpxo8FPc49Hrnwh";
const CHAT_ID = process.argv[3] || "oc_27d4fdfc775abaf71cffdc9ccbf3c0de";
const BASE = "https://open.feishu.cn/open-apis";

const r1 = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ app_id: process.env.FEISHU_APP_ID, app_secret: process.env.FEISHU_APP_SECRET }),
});
const j1 = await r1.json();
if (j1.code !== 0) throw new Error("token failed: " + JSON.stringify(j1));
const auth = { Authorization: `Bearer ${j1.tenant_access_token}`, "Content-Type": "application/json" };
console.log("== token ok ==");

// 1. 当前协作者列表
let r = await fetch(`${BASE}/drive/v1/permissions/${DOC_TOKEN}/members?type=docx`, { headers: auth });
console.log("== members ==", JSON.stringify(await r.json(), null, 2));

// 2. 公开分享设置 (v2)
r = await fetch(`${BASE}/drive/v2/permissions/${DOC_TOKEN}/public?type=docx`, { headers: auth });
console.log("== public ==", JSON.stringify(await r.json(), null, 2));

// 3. 授权群（打印真实返回）
r = await fetch(`${BASE}/drive/v1/permissions/${DOC_TOKEN}/members?type=docx&need_notification=false`, {
  method: "POST", headers: auth,
  body: JSON.stringify({ member_type: "openchat", member_id: CHAT_ID, perm: "view" }),
});
console.log("== grant chat ==", JSON.stringify(await r.json(), null, 2));

// 4. 开启"组织内获得链接的人可查看"作为兜底
r = await fetch(`${BASE}/drive/v2/permissions/${DOC_TOKEN}/public?type=docx`, {
  method: "PATCH", headers: auth,
  body: JSON.stringify({ link_share_entity: "tenant_readable" }),
});
console.log("== set tenant_readable ==", JSON.stringify(await r.json(), null, 2));
