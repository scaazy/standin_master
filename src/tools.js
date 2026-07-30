// Tool definitions (OpenAI function-calling schema) + dispatcher.

import * as ws from "./workspace.js";
import { promisify } from "node:util";
import { exec } from "node:child_process";
import os from "node:os";
import path from "node:path";

const execAsync = promisify(exec);

export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a text file inside the workspace. Returns file content.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Workspace-relative file path" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List files and directories at a workspace path.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Workspace-relative dir path, default '.'" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_workspace",
      description: "Search for files containing a query string inside the workspace.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          path: { type: "string", description: "Subdirectory to search, default '.'" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write (create or overwrite) a text file inside the workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command in the workspace directory (Windows PowerShell/cmd).",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The command to run" },
          timeoutMs: { type: "number", description: "Timeout in ms, default 120000" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "install_skill",
      description: "Install a Codex skill into ~/.codex/skills. Accepts a curated skill name or a GitHub repo path like owner/repo.",
      parameters: {
        type: "object",
        properties: { name_or_repo: { type: "string", description: "Skill name or GitHub owner/repo" } },
        required: ["name_or_repo"],
      },
    },
  },
];

export const TOOL_RISK = {
  read_file: "low",
  list_dir: "low",
  search_workspace: "low",
  write_file: "high",
  run_command: "high",
  install_skill: "high",
};

async function installSkill(args) {
  const nameOrRepo = args && args.name_or_repo;
  if (!nameOrRepo) return { ok: false, error: "name_or_repo is required" };
  const skillsDir = path.join(os.homedir(), ".codex", "skills");
  const isRepo = nameOrRepo.includes("/");
  try {
    if (isRepo) {
      const url = "https://github.com/" + nameOrRepo + ".git";
      const dest = path.join(skillsDir, nameOrRepo.split("/").pop());
      await execAsync("git clone --depth 1 " + url + " \"" + dest + "\"", { timeout: 120000 });
      return { ok: true, installed: dest, source: url };
    }
    const r = await execAsync("npx -y skills add " + nameOrRepo + " -g", { timeout: 180000, encoding: "buffer" });
    return {
      ok: true,
      stdout: ws.decodeCmdOutput(r.stdout).slice(0, 4000),
      stderr: ws.decodeCmdOutput(r.stderr).slice(0, 2000),
    };
  } catch (e) {
    return {
      ok: false,
      error: e.message,
      stderr: ws.decodeCmdOutput(e.stderr).slice(0, 2000),
    };
  }
}

export async function dispatchTool(name, args) {
  switch (name) {
    case "read_file": return ws.readFile(args || {});
    case "list_dir": return ws.listDir(args || {});
    case "search_workspace": return ws.searchWorkspace(args || {});
    case "write_file": return ws.writeFile(args || {});
    case "run_command": return ws.runCommand(args || {});
    case "install_skill": return installSkill(args || {});
    default: return { ok: false, error: "unknown tool: " + name };
  }
}
