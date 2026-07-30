// �?DFS 测试产物以飞书文档形式发到群�?import fs from "node:fs";

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const CHAT_ID = "oc_27d4fdfc775abaf71cffdc9ccbf3c0de";
const BASE = "https://open.feishu.cn/open-apis";

if (!APP_ID || !APP_SECRET) { console.error("missing app credentials"); process.exit(1); }

async function getToken() {
  const r = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error("token failed: " + JSON.stringify(j));
  return j.tenant_access_token;
}

function buildMarkdown() {
  const testcases = fs.readFileSync("demo/wireless-dfs/dfs-tests/testcases.md", "utf8");
  const testPy = fs.readFileSync("demo/wireless-dfs/dfs-tests/test_dfs.py", "utf8");
  const dutPy = fs.readFileSync("demo/wireless-dfs/dfs-tests/dut.py", "utf8");
  const conftest = fs.readFileSync("demo/wireless-dfs/dfs-tests/conftest.py", "utf8");
  return `# 无线 DFS 特性自动化测试交付

> �?prd-to-test-automation skill �?PRD 自动拆解生成。执行结果：**13 passed in 0.05s**

${testcases}

---

## 自动化测试脚本（Step 3 输出�?
### test_dfs.py �?用例脚本

\`\`\`python
${testPy}
\`\`\`

### dut.py �?DFS 状态机模拟器（可注入时钟，接真�?AP 时仅替换此文件）

\`\`\`python
${dutPy}
\`\`\`

### conftest.py �?pytest fixture

\`\`\`python
${conftest}
\`\`\`

---

## 执行说明

\`\`\`bash
cd demo/wireless-dfs/dfs-tests
pip install pytest
pytest -v          # 13 passed
\`\`\`
`;
}

async function main() {
  const token = await getToken();
  const auth = { Authorization: `Bearer ${token}` };
  const md = buildMarkdown();
  const buf = Buffer.from(md, "utf8");

  // 1. 上传 md 文件
  const form = new FormData();
  form.append("file_name", "dfs-automation.md");
  form.append("parent_type", "ccm_import_open");
  form.append("size", String(buf.length));
  form.append("file", new Blob([buf]), "dfs-automation.md");
  form.append("extra", JSON.stringify({ obj_type: "docx", file_extension: "md" }));
  let r = await fetch(`${BASE}/drive/v1/medias/upload_all`, { method: "POST", headers: auth, body: form });
  let j = await r.json();
  if (j.code !== 0) throw new Error("upload failed: " + JSON.stringify(j));
  const fileToken = j.data.file_token;
  console.log("uploaded:", fileToken);

  // 2. 创建导入任务（point = 挂载到我的空间根目录�?  r = await fetch(`${BASE}/drive/v1/import_tasks`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      file_extension: "md",
      file_token: fileToken,
      type: "docx",
      file_name: "无线DFS特性自动化测试",
      point: { mount_type: 1, mount_key: "" },
    }),
  });
  j = await r.json();
  if (j.code !== 0) throw new Error("import task failed: " + JSON.stringify(j));
  const ticket = j.data.ticket;
  console.log("import ticket:", ticket);

  // 3. 轮询导入结果
  let docToken = null, docUrl = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((s) => setTimeout(s, 1000));
    r = await fetch(`${BASE}/drive/v1/import_tasks/${ticket}`, { headers: auth });
    j = await r.json();
    if (j.code !== 0) throw new Error("poll failed: " + JSON.stringify(j));
    const res = j.data.result;
    if (res && res.job_status === 0) { docToken = res.token; docUrl = res.url; break; }
    if (res && res.job_status !== 1 && res.job_status !== 2) throw new Error("import error: " + JSON.stringify(res));
  }
  if (!docToken) throw new Error("import timeout");
  console.log("doc created:", docToken, docUrl);

  // 4. 授权群成员可查看
  r = await fetch(`${BASE}/drive/v1/permissions/${docToken}/members?type=docx&need_notification=false`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ member_type: "openchat", member_id: CHAT_ID, perm: "view" }),
  });
  j = await r.json();
  console.log("perm:", JSON.stringify(j));

  // 4.5 开启链接分享：组织内获得链接可查看（否则群成员点链接会提示无权限）
  r = await fetch(`${BASE}/drive/v2/permissions/${docToken}/public?type=docx`, {
    method: "PATCH",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ link_share_entity: "tenant_readable" }),
  });
  j = await r.json();
  console.log("link_share:", JSON.stringify(j));

  // 5. 群内发送文档卡�?  const link = docUrl || `https://feishu.cn/docx/${docToken}`;
  const card = {
    config: { wide_screen_mode: true },
    header: { title: { tag: "plain_text", content: "📄 无线 DFS 特性自动化测试文档" }, template: "blue" },
    elements: [
      { tag: "div", text: { tag: "lark_md", content: "PRD �?用例 �?自动化脚�?全流程交付\n**执行结果�?3 passed in 0.05s** �? } },
      { tag: "action", actions: [{ tag: "button", text: { tag: "plain_text", content: "打开文档" }, url: link, type: "primary" }] },
    ],
  };
  r = await fetch(`${BASE}/im/v1/messages?receive_id_type=chat_id`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ receive_id: CHAT_ID, msg_type: "interactive", content: JSON.stringify(card) }),
  });
  j = await r.json();
  if (j.code !== 0) throw new Error("send msg failed: " + JSON.stringify(j));
  console.log("sent to chat. done.");
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
