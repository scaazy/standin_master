// Feishu image download/upload helpers for vision input and image replies.

let cachedToken = null;
let tokenExpiry = 0;

export async function getTenantToken(appId, appSecret) {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const resp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await resp.json();
  if (!data.tenant_access_token) throw new Error("failed to get tenant token: " + JSON.stringify(data).slice(0, 200));
  cachedToken = data.tenant_access_token;
  tokenExpiry = Date.now() + (data.expire - 300) * 1000;
  return cachedToken;
}

export function bufferToDataUrl(buf, mime = "image/png") {
  return "data:" + String(mime).split(";")[0] + ";base64," + buf.toString("base64");
}

export function dataUrlToBuffer(dataUrl) {
  const m = String(dataUrl).match(/^data:([^;,]+)?(?:;base64)?,(.*)$/);
  if (!m) throw new Error("invalid data url");
  return { buf: Buffer.from(m[2], "base64"), mime: m[1] || "image/png" };
}

export async function downloadImageBuffer({ appId, appSecret, messageId, fileKey }) {
  const token = await getTenantToken(appId, appSecret);
  const url = "https://open.feishu.cn/open-apis/im/v1/messages/" + messageId + "/resources/" + fileKey + "?type=image";
  const resp = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (!resp.ok) throw new Error("image download failed: HTTP " + resp.status);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > 25 * 1024 * 1024) throw new Error("image too large: " + buf.length);
  const mime = resp.headers.get("content-type") || "image/png";
  return { buf, mime: mime.split(";")[0] };
}

export async function downloadImageBase64({ appId, appSecret, messageId, fileKey }) {
  const { buf, mime } = await downloadImageBuffer({ appId, appSecret, messageId, fileKey });
  return bufferToDataUrl(buf, mime);
}

// Upload an image buffer to Feishu and return image_key.
export async function uploadImageBuffer({ client, buffer }) {
  const res = await client.im.v1.image.create({
    data: { image_type: "message", image: buffer },
  });
  const imageKey = res?.image_key ?? res?.data?.image_key;
  if (!imageKey) throw new Error("image_key missing in upload response");
  return imageKey;
}

export async function replyImageBuffer({ client, messageId, buffer }) {
  const imageKey = await uploadImageBuffer({ client, buffer });
  await client.im.message.reply({
    path: { message_id: messageId },
    data: { msg_type: "image", content: JSON.stringify({ image_key: imageKey }) },
  });
  return imageKey;
}
