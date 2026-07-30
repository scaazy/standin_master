// Persistent state: authorized group chats + pending approvals.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, "..", "data.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { invitedChats: [], approvals: {}, nextApprovalId: 1 };
  }
}

function save(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

export class State {
  constructor() {
    this.data = load();
  }

  isChatInvited(chatId) {
    return this.data.invitedChats.includes(chatId);
  }

  inviteChat(chatId) {
    if (!this.isChatInvited(chatId)) {
      this.data.invitedChats.push(chatId);
      save(this.data);
    }
  }

  uninviteChat(chatId) {
    this.data.invitedChats = this.data.invitedChats.filter((c) => c !== chatId);
    save(this.data);
  }

  createApproval(entry) {
    const id = this.data.nextApprovalId++;
    this.data.approvals[id] = { id, status: "pending", createdAt: Date.now(), ...entry };
    save(this.data);
    return this.data.approvals[id];
  }

  getApproval(id) {
    return this.data.approvals[id];
  }

  setApprovalStatus(id, status) {
    if (this.data.approvals[id]) {
      this.data.approvals[id].status = status;
      this.data.approvals[id].resolvedAt = Date.now();
      save(this.data);
    }
  }

  pendingApprovals() {
    return Object.values(this.data.approvals).filter((a) => a.status === "pending");
  }
}
