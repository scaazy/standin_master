// Token usage tracking: record each API call's usage and persist to disk.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATS_FILE = path.join(__dirname, "..", "token-stats.json");

function emptyBucket() {
  return { prompt: 0, completion: 0, total: 0, calls: 0 };
}

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
    data.total ??= emptyBucket();
    data.days ??= {};
    return data;
  } catch {
    return { total: emptyBucket(), days: {} };
  }
}

function save(data) {
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("[tokens] save failed:", e.message);
  }
}

function todayKey() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function addTo(bucket, usage) {
  bucket.prompt += Number(usage.prompt_tokens ?? 0);
  bucket.completion += Number(usage.completion_tokens ?? 0);
  bucket.total += Number(usage.total_tokens ?? 0);
  bucket.calls += 1;
}

export class TokenTracker {
  constructor() {
    this.data = load();
    // In-memory stats since this bot process started.
    this.session = emptyBucket();
  }

  // usage: { prompt_tokens, completion_tokens, total_tokens } from the API response.
  record(usage) {
    if (!usage || typeof usage !== "object") return;
    addTo(this.session, usage);
    addTo(this.data.total, usage);
    const key = todayKey();
    this.data.days[key] ??= emptyBucket();
    addTo(this.data.days[key], usage);
    save(this.data);
  }

  today() {
    return this.data.days[todayKey()] ?? emptyBucket();
  }

  report() {
    const fmt = (label, b) =>
      `${label}：${b.total.toLocaleString()} tokens（输入 ${b.prompt.toLocaleString()} + 输出 ${b.completion.toLocaleString()}，${b.calls} 次调用）`;
    return [
      "📊 Token 用量统计",
      fmt("本次运行", this.session),
      fmt("今日累计", this.today()),
      fmt("历史总计", this.data.total),
    ].join("\n");
  }
}

export const tokenTracker = new TokenTracker();
