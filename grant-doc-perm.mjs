// 给已创建的文档授权群成员可查看
const BASE = "https://open.feishu.cn/open-apis";
const DOC_TOKEN = process.argv[2];
const CHAT_ID = process.argv[3];
if (!DOC_TOKEN || !CHAT_ID) { console.error("usage: node grant-doc-perm.mjs <docToken> <chatId>"); process.exit(1); }

const r1 = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ app_id: process.env.FEISHU_APP_ID, app_secret: process.env.FEISHU_APP_SECRET }),
});
const j1 = await r1.json();
if (j1.code !== 0) throw new Error("token failed: " + JSON.stringify(j1));

const r2 = await fetch(`${BASE}/drive/v1/permissions/${DOC_TOKEN}/members?type=docx&need_notification=false`, {
  method: "POST",
  headers: { Authorization: `Bearer ${j1.tenant_access_token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ member_type: "openchat", member_id: CHAT_ID, perm: "view" }),
});
console.log("perm:", JSON.stringify(await r2.json()));
