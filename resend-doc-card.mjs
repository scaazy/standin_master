// 权限修复后，在群内重发文档链接
import fs from "node:fs";
const envText = fs.readFileSync(new URL("./.env", import.meta.url), "utf8").replace(/^﻿/, "");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const CHAT_ID = "oc_27d4fdfc775abaf71cffdc9ccbf3c0de";
const BASE = "https://open.feishu.cn/open-apis";

const r1 = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ app_id: process.env.FEISHU_APP_ID, app_secret: process.env.FEISHU_APP_SECRET }),
});
const j1 = await r1.json();
const auth = { Authorization: `Bearer ${j1.tenant_access_token}`, "Content-Type": "application/json" };

const card = {
  config: { wide_screen_mode: true },
  header: { title: { tag: "plain_text", content: "📄 无线 DFS 特性自动化测试文档（权限已修复）" }, template: "green" },
  elements: [
    { tag: "div", text: { tag: "lark_md", content: "已开启「组织内获得链接可查看」，群成员点击即可打开。\n内容：PRD → 用例 → 自动化脚本（**13 passed**）" } },
    { tag: "action", actions: [{ tag: "button", text: { tag: "plain_text", content: "打开文档" }, url: "https://my.feishu.cn/docx/QvzWdz1VpoBqHpxo8FPc49Hrnwh", type: "primary" }] },
  ],
};
const r = await fetch(`${BASE}/im/v1/messages?receive_id_type=chat_id`, {
  method: "POST", headers: auth,
  body: JSON.stringify({ receive_id: CHAT_ID, msg_type: "interactive", content: JSON.stringify(card) }),
});
const j = await r.json();
console.log(j.code === 0 ? "sent ok" : "send failed: " + JSON.stringify(j));
