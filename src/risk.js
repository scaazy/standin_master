// Lightweight risk classification of user text.
// Note: \b word boundaries don't work for CJK, so Chinese patterns avoid \b.

const HIGH_RISK_PATTERNS = [
  // command execution
  /\b(exec|execute|shell|powershell|bash|terminal|cmd\.exe)\b/i,
  /(执行|运行|跑一下|帮我跑).{0,20}(命令|脚本|程序|shell|powershell|cmd)/i,
  // filesystem destructive
  /\b(rm\s+-|del\s|delete|remove|drop|format|mkfs)\b/i,
  /(删除|删掉|清空|格式化).{0,30}(文件|目录|数据|库|磁盘|盘)/i,
  // filesystem read
  /\b(cat|type|tail|head)\s+[^\s]+/i,
  /(读取|查看|打开|看一下|看看).{0,20}(文件|目录|配置|日志|内容)/i,
  // write
  /(写入|保存|修改|覆盖|追加).{0,20}(文件|配置|代码)/i,
  // network transfer
  /\b(curl|wget|scp|ftp)\b/i,
  /(下载|上传).{0,20}(文件|到|从)/i,
  // sending messages / mail to others
  /(发送|转发|发给|发).{0,10}(消息|邮件|email|mail)|转发.{0,10}(给|他|她|它|别人|群)/i,
  // absolute paths & traversal
  /[A-Za-z]:\\/,
  /\/(etc|home|root|var|usr)\//,
  /\.\.[\\/]/,
  // credentials
  /(api[_ -]?key|secret|token|password|passwd|密钥|密码|令牌|凭证)/i,
];

export function classifyRisk(text) {
  if (!text) return { level: "low", reasons: [] };
  const reasons = [];
  for (const p of HIGH_RISK_PATTERNS) {
    if (p.test(text)) reasons.push(p.source.slice(0, 50));
  }
  return { level: reasons.length ? "high" : "low", reasons };
}
