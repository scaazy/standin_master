# standin_master — 飞书 Kimi 智能体

飞书自建应用机器人，收到私聊/群聊 @ 消息后调用 Kimi K3（与本地 Codex 相同的 API 端点）并回复。支持识图；图片修复回传需要额外配置图像修复服务。

## 架构

```
飞书用户 <--(WebSocket 长连接)--> 本服务 <--(OpenAI 兼容 API)--> Kimi 本地代理 (127.0.0.1:8765)
图片消息: 飞书 image_key --> 下载原图 --> 图像修复服务 --> 上传 image_key --> 飞书回图
```

- 事件接收：`@larksuiteoapi/node-sdk` 的 WebSocket 长连接模式，无需公网回调地址
- 模型：`kimi-k3`，经由本地代理 `http://127.0.0.1:8765/v1`（与 Codex 配置一致）
- 会话记忆：按 chat_id 维护最近 12 轮对话；发送 `/clear` 或 `清空` 可重置
- 识图：消息中的图片会下载为 data URL 传给多模态模型
- 修图回传：识别到“修复/清晰化/老照片/放大”等意图且消息带图时，走确定性链路：下载原图 → 调修复服务 → 上传飞书 → 回复图片

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

图片修复服务（二选一）：

| 变量 | 说明 |
|---|---|
| `IMAGE_EDIT_WEBHOOK_URL` | 推荐。自建/第三方修复接口；接收 JSON `{ prompt, image: dataUrl }`，返回 `{ image_base64 }` / `{ data_url }` / `{ url }` 或直接图片字节 |
| `IMAGE_EDIT_WEBHOOK_KEY` | 可选，Webhook Bearer Key |
| `IMAGE_EDIT_BASE_URL` | OpenAI 兼容图片编辑接口地址，如 `https://api.openai.com/v1` |
| `IMAGE_EDIT_API_KEY` | 图片编辑接口 Key |
| `IMAGE_EDIT_MODEL` | 默认 `gpt-image-1` |
| `IMAGE_EDIT_SIZE` | 可选，如 `1024x1024`；人像建议留空或按服务支持设置 |

> 注意：Kimi K3 多模态默认可“看图理解”，不等于内置图像编辑输出。要真正回传修复图，需要接上述任意一个图像修复服务。

## 飞书开放平台需要配置

1. **机器人能力**：应用详情 → 添加应用能力 → 机器人
2. **权限**：`im:message`、`im:message.receive_v1`（接收消息事件）、`im:message:send_as_bot`；图片上传/下载需要 `im:resource`
3. **事件订阅**：订阅方式选「长连接」，添加事件 `im.message.receive_v1`
4. **版本发布**：创建版本并发布（企业自建应用需管理员审核或直接可用）

## 运行

```bash
npm install
# 确保 Kimi 本地代理已启动 (127.0.0.1:8765)
npm start
```

然后在飞书里搜索你的机器人，私聊发消息即可。群里需要 @ 机器人。

## 图片修复用法

在飞书发送图片并说一句：“修复这张照片并发给我 / 清晰化 / 老照片修复”。若已配置 `IMAGE_EDIT_*`，机器人会直接回传修复后的图片；若未配置，会提示需要补配置，但仍可正常识图分析。
