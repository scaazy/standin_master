// Per-chat conversation memory with a simple sliding window.

export class SessionStore {
  constructor({ maxTurns = 12 } = {}) {
    this.maxTurns = maxTurns;
    this.chats = new Map();
  }

  get(chatId) {
    return this.chats.get(chatId) ?? [];
  }

  append(chatId, userText, assistantText) {
    const history = this.chats.get(chatId) ?? [];
    history.push({ role: "user", content: userText });
    history.push({ role: "assistant", content: assistantText });
    this.chats.set(chatId, history.slice(-this.maxTurns * 2));
  }

  clear(chatId) {
    this.chats.delete(chatId);
  }
}
