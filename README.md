# standin_master — 飞书 Kimi 智能体

飞书自建应用机器人，收到私聊消息后调用 Kimi K3（与本地 Codex 相同的 API 端点）并回复。

## 架构

```
飞书用户 <--(WebSocket 长连接)--> 本服务 <--(OpenAI 兼容 API)--> Kimi 本地代理 (127.0.0.1:8765)
```

- 事件接收：`@larksuiteoapi/node-sdk` 的 WebSocket 长连接模式，无需公网回调地址
- 模型：`kimi-k3`，经由本地代理 `http://127.0.0.1:8765/v1`（与 Codex 配置一致）
- 会话记忆：按 chat_id 维护最近 12 轮对话；发送 `/clear` 或 `清空` 可重置

## 配置

复制 `.env.example` 为 `.env` 并填写：

| 变量 | 说明 |
|---|---|
| `FEISHU_APP_ID` | 飞书自建应用 App ID |
| `FEISHU_APP_SECRET` | 飞书自建应用 App Secret |
| `KIMI_BASE_URL` | Kimi 代理地址，默认 `http://127.0.0.1:8765/v1` |
| `KIMI_API_KEY` | 与 `MOONSHOT_API_KEY` 相同 |
| `KIMI_MODEL` | 默认 `kimi-k3` |
| `BOT_SYSTEM_PROMPT` | 可选，机器人系统提示词 |

## 飞书开放平台需要配置

1. **机器人能力**：应用详情 → 添加应用能力 → 机器人
2. **权限**：`im:message`、`im:message.receive_v1`（接收消息事件）、`im:message:send_as_bot`
3. **事件订阅**：订阅方式选「长连接」，添加事件 `im.message.receive_v1`
4. **版本发布**：创建版本并发布（企业自建应用需管理员审核或直接可用）

## 运行

```bash
npm install
# 确保 Kimi 本地代理已启动 (127.0.0.1:8765)
npm start
```

然后在飞书里搜索你的机器人，私聊发消息即可。
