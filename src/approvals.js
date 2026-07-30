// Approval workflow: notify admin, wait for approve/reject.

import { buildApprovalCard } from "./card.js";

export class ApprovalManager {
  constructor({ client, state, adminOpenId, timeoutMs = 10 * 60 * 1000 }) {
    this.client = client;
    this.state = state;
    this.adminOpenId = adminOpenId;
    this.timeoutMs = timeoutMs;
    this.waiters = new Map();
  }

  async requestApproval(entry) {
    // entry: { requesterOpenId, requesterName, chatId, text?, risk?, toolName?, toolArgs? }
    const approval = this.state.createApproval(entry);
    const card = buildApprovalCard(approval);
    await this.client.im.message.create({
      params: { receive_id_type: "open_id" },
      data: {
        receive_id: this.adminOpenId,
        msg_type: "interactive",
        content: JSON.stringify(card),
      },
    });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.waiters.has(approval.id)) {
          this.waiters.delete(approval.id);
          this.state.setApprovalStatus(approval.id, "expired");
          resolve({ approved: false, reason: "timeout" });
        }
      }, this.timeoutMs);
      this.waiters.set(approval.id, { resolve, timer });
    });
  }

  resolve(approvalId, approved) {
    const w = this.waiters.get(approvalId);
    if (!w) return false;
    clearTimeout(w.timer);
    this.waiters.delete(approvalId);
    this.state.setApprovalStatus(approvalId, approved ? "approved" : "rejected");
    w.resolve({ approved });
    return true;
  }

  parseCommand(text) {
    const m = text.match(/^\/(approve|reject)\s+(\d+)/i);
    if (!m) return null;
    return { action: m[1].toLowerCase(), id: Number(m[2]) };
  }
}
