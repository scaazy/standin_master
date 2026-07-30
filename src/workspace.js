// Workspace-scoped filesystem and command tools.

import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const WORKSPACE = process.env.WORKSPACE_ROOT || "D:\\software\\codex";

export function getWorkspaceRoot() {
  return path.resolve(WORKSPACE);
}

// Decode child-process output bytes. Chinese Windows consoles emit GBK/CP936
// bytes while Node's exec defaults to UTF-8 decoding, which caused mojibake.
// Strategy: try UTF-8; if it yields U+FFFD replacement chars, fall back to GBK.
export function decodeCmdOutput(data) {
  if (data == null) return "";
  if (!Buffer.isBuffer(data)) return String(data);
  if (data.length === 0) return "";
  const utf8 = data.toString("utf8");
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("gbk").decode(data);
  } catch {
    return utf8;
  }
}

// Node's exec error message embeds output decoded with the wrong encoding,
// so rebuild a clean error string from the exit code/signal instead.
function buildCmdError(e, command) {
  const parts = ["Command failed"];
  if (e.code != null) parts.push(`exit=${e.code}`);
  if (e.signal) parts.push(`signal=${e.signal}`);
  if (e.killed) parts.push("killed(timeout)");
  parts.push(`: ${command}`);
  return parts.join(" ");
}

// Resolve a user-supplied path against the workspace; refuse escapes.
export function resolveInWorkspace(p) {
  if (!p) return { ok: false, error: "path is required" };
  const abs = path.resolve(getWorkspaceRoot(), p);
  const root = getWorkspaceRoot().toLowerCase();
  const absLower = abs.toLowerCase();
  if (absLower !== root && !absLower.startsWith(root + path.sep)) {
    return { ok: false, error: `路径 ${p} 超出工作区范围，已拒绝` };
  }
  return { ok: true, abs };
}

export async function readFile({ path: p, maxBytes = 200 * 1024 }) {
  const r = resolveInWorkspace(p);
  if (!r.ok) return { ok: false, error: r.error };
  try {
    const stat = fs.statSync(r.abs);
    if (stat.isDirectory()) return { ok: false, error: `${p} 是目录，不是文件` };
    if (stat.size > maxBytes) return { ok: false, error: `文件太大（${stat.size} 字节）` };
    const content = fs.readFileSync(r.abs, "utf8");
    return { ok: true, path: r.abs, content };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function listDir({ path: p = "." }) {
  const r = resolveInWorkspace(p);
  if (!r.ok) return { ok: false, error: r.error };
  try {
    const entries = fs.readdirSync(r.abs, { withFileTypes: true });
    const list = entries.map((e) => ({
      name: e.name,
      type: e.isDirectory() ? "dir" : "file",
    }));
    return { ok: true, path: r.abs, entries: list };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function writeFile({ path: p, content }) {
  const r = resolveInWorkspace(p);
  if (!r.ok) return { ok: false, error: r.error };
  try {
    fs.mkdirSync(path.dirname(r.abs), { recursive: true });
    fs.writeFileSync(r.abs, content ?? "", "utf8");
    return { ok: true, path: r.abs, bytes: Buffer.byteLength(content ?? "", "utf8") };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function runCommand({ command, timeoutMs = 120000 }) {
  if (!command) return { ok: false, error: "command is required" };
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: getWorkspaceRoot(),
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      encoding: "buffer", // capture raw bytes, decode ourselves (GBK-safe)
    });
    return {
      ok: true,
      stdout: decodeCmdOutput(stdout).slice(0, 8000),
      stderr: decodeCmdOutput(stderr).slice(0, 4000),
    };
  } catch (e) {
    return {
      ok: false,
      error: buildCmdError(e, command),
      stdout: decodeCmdOutput(e.stdout).slice(0, 8000),
      stderr: decodeCmdOutput(e.stderr).slice(0, 4000),
    };
  }
}

export async function searchWorkspace({ query, path: p = ".", maxResults = 20 }) {
  const r = resolveInWorkspace(p);
  if (!r.ok) return { ok: false, error: r.error };
  const results = [];
  const needle = (query ?? "").toLowerCase();
  if (!needle) return { ok: false, error: "query is required" };

  function walk(dir) {
    if (results.length >= maxResults) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (results.length >= maxResults) return;
      if (e.name === "node_modules" || e.name === ".git") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      try {
        const text = fs.readFileSync(full, "utf8");
        if (text.toLowerCase().includes(needle)) {
          results.push(path.relative(getWorkspaceRoot(), full));
        }
      } catch {}
    }
  }
  walk(r.abs);
  return { ok: true, query, results };
}
