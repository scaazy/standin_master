// Slash-command CLI for the bot.

export const COMMANDS = [
  { name: "/help", desc: "列出所有命令", admin: false },
  { name: "/new", desc: "清空当前会话上下文，开始新对话", admin: false },
  { name: "/stop", desc: "停止当前正在生成的回复", admin: false },
  { name: "/token", desc: "查看本会话累计消耗的 token", admin: false },
  { name: "/mode", desc: "查看当前模式（流式/卡片）", admin: false },
  { name: "/whoami", desc: "显示你的身份（是否管理员）", admin: false },
  { name: "/tokens", desc: "查看 token 用量统计", admin: false },
  { name: "/model [名字]", desc: "查看或切换模型", admin: true },
  { name: "/invite", desc: "授权机器人在当前群聊回复", admin: true },
  { name: "/uninvite", desc:  "取消当前群聊授权", admin: true },
  { name: "/pending", desc: "查看待审批列表", admin: true },
  { name: "/approve <id>", desc: "同意审批", admin: true },
  { name: "/reject <id>", desc: "拒绝审批", admin: true },
];

export function helpText(isAdminUser) {
  const lines = COMMANDS
    .filter((c) => !c.admin || isAdminUser)
    .map((c) => `${c.name} — ${c.desc}`);
  return "可用命令：\n" + lines.join("\n");
}

// Parse "/cmd arg1 arg2" -> { cmd: "/cmd", args: ["arg1","arg2"], raw }
export function parseCommand(text) {
  if (!text || !text.startsWith("/")) return null;
  const parts = text.trim().split(/\s+/);
  return { cmd: parts[0].toLowerCase(), args: parts.slice(1), raw: text };
}
