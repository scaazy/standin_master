// Pluggable image restoration provider.
// Priority:
//  A) Generic webhook (self-hosted CodeFormer/Real-ESRGAN/etc):
//     IMAGE_EDIT_WEBHOOK_URL=http://127.0.0.1:9000/restore
//     Optional: IMAGE_EDIT_WEBHOOK_KEY=...
//     Request:  POST JSON { prompt, image: "data:image/...;base64,..." }
//     Response: { image_base64 } | { data_url } | { url } | raw image bytes
//
//  B) OpenAI-compatible Images Edit API:
//     IMAGE_EDIT_BASE_URL=https://api.openai.com/v1
//     IMAGE_EDIT_API_KEY=sk-...
//     IMAGE_EDIT_MODEL=gpt-image-1
//
//  C) Built-in local OpenCV pipeline (no config needed):
//     Runs `python enhance.py` (denoise -> white balance -> 2x upscale -> unsharp).
//     Disable with IMAGE_EDIT_LOCAL=0. Requires python + opencv-python-headless + numpy.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bufferToDataUrl, dataUrlToBuffer } from "./image.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENHANCE_SCRIPT = path.join(__dirname, "..", "enhance.py");

export const DEFAULT_RESTORE_PROMPT = [
  "照片级保守修复：提升清晰度和分辨率，轻微去模糊、去噪、减少压缩痕迹；",
  "严格保持人物原本五官、脸型、表情、年龄和构图，不换脸、不美颜、不大眼瘦脸、不过度磨皮；",
  "校正轻微偏色和过曝，肤色自然，保留服装纹理、背景图案和年代质感；",
  "不添加新元素，不改变画面内容，输出自然真实的高清版本。",
].join("");

function missingProviderError() {
  return new Error(
    "图片修复服务不可用：本地 OpenCV 修复失败，且未配置 IMAGE_EDIT_WEBHOOK_URL / IMAGE_EDIT_BASE_URL。"
  );
}

async function responseToImageBuffer(resp) {
  const contentType = resp.headers.get("content-type") || "";
  if (contentType.startsWith("image/")) {
    return { buf: Buffer.from(await resp.arrayBuffer()), mime: contentType.split(";")[0] };
  }
  const data = await resp.json().catch(async () => ({ raw: await resp.text().catch(() => "") }));
  const b64 = data?.image_base64 ?? data?.b64_json ?? data?.data?.[0]?.b64_json;
  if (b64) return { buf: Buffer.from(b64, "base64"), mime: data?.mime || "image/png" };
  const dataUrl = data?.data_url ?? data?.image_url ?? data?.data?.[0]?.data_url;
  if (dataUrl && String(dataUrl).startsWith("data:")) return dataUrlToBuffer(dataUrl);
  const url = data?.url ?? data?.image_url ?? data?.data?.[0]?.url;
  if (url && /^https?:\/\//.test(url)) {
    const img = await fetch(url);
    if (!img.ok) throw new Error("provider image url fetch failed: HTTP " + img.status);
    return { buf: Buffer.from(await img.arrayBuffer()), mime: (img.headers.get("content-type") || "image/png").split(";")[0] };
  }
  throw new Error("provider returned no image: " + JSON.stringify(data).slice(0, 500));
}

async function restoreViaWebhook({ inputBuffer, inputMime, prompt, signal }) {
  const url = process.env.IMAGE_EDIT_WEBHOOK_URL;
  if (!url) throw missingProviderError();
  const headers = { "Content-Type": "application/json" };
  if (process.env.IMAGE_EDIT_WEBHOOK_KEY) headers.Authorization = "Bearer " + process.env.IMAGE_EDIT_WEBHOOK_KEY;
  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt, image: bufferToDataUrl(inputBuffer, inputMime) }),
    signal,
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error("image webhook failed: HTTP " + resp.status + " " + t.slice(0, 300));
  }
  return responseToImageBuffer(resp);
}

async function restoreViaOpenAIImages({ inputBuffer, inputMime, prompt, signal }) {
  const baseUrl = process.env.IMAGE_EDIT_BASE_URL;
  const apiKey = process.env.IMAGE_EDIT_API_KEY;
  const model = process.env.IMAGE_EDIT_MODEL || "gpt-image-1";
  if (!baseUrl || !apiKey) throw missingProviderError();

  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  const ext = inputMime.includes("jpeg") || inputMime.includes("jpg") ? "jpg" : inputMime.includes("webp") ? "webp" : "png";
  form.append("image", new Blob([inputBuffer], { type: inputMime || "image/png" }), "input." + ext);
  if (process.env.IMAGE_EDIT_SIZE) form.append("size", process.env.IMAGE_EDIT_SIZE);

  const resp = await fetch(baseUrl.replace(/\/+$/, "") + "/images/edits", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey },
    body: form,
    signal,
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error("image edit API failed: HTTP " + resp.status + " " + t.slice(0, 300));
  }
  return responseToImageBuffer(resp);
}

// Built-in local pipeline: python enhance.py <in> <out>
function restoreViaLocalOpenCV({ inputBuffer, inputMime }) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imgfix-"));
    const ext = inputMime.includes("png") ? "png" : "jpg";
    const inPath = path.join(dir, "in." + ext);
    const outPath = path.join(dir, "out.jpg");
    fs.writeFileSync(inPath, inputBuffer);
    const child = spawn("python", [ENHANCE_SCRIPT, inPath, outPath], { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("local enhance timeout")); }, 120000);
    child.on("error", (e) => { clearTimeout(timer); reject(new Error("spawn python failed: " + e.message)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0 || !fs.existsSync(outPath)) {
          return reject(new Error(`enhance.py exit=${code} ${stderr.slice(-300)}`));
        }
        resolve({ buf: fs.readFileSync(outPath), mime: "image/jpeg" });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
}

export function isImageRestoreConfigured() {
  return Boolean(
    process.env.IMAGE_EDIT_WEBHOOK_URL ||
    (process.env.IMAGE_EDIT_BASE_URL && process.env.IMAGE_EDIT_API_KEY) ||
    process.env.IMAGE_EDIT_LOCAL !== "0"
  );
}

export async function restoreImageBuffer({ inputBuffer, inputMime = "image/png", prompt = DEFAULT_RESTORE_PROMPT, signal }) {
  if (!inputBuffer?.length) throw new Error("empty input image");
  if (process.env.IMAGE_EDIT_WEBHOOK_URL) return restoreViaWebhook({ inputBuffer, inputMime, prompt, signal });
  if (process.env.IMAGE_EDIT_BASE_URL && process.env.IMAGE_EDIT_API_KEY) return restoreViaOpenAIImages({ inputBuffer, inputMime, prompt, signal });
  if (process.env.IMAGE_EDIT_LOCAL !== "0") {
    try {
      return await restoreViaLocalOpenCV({ inputBuffer, inputMime });
    } catch (e) {
      console.error("[image-restore] local OpenCV fallback failed:", e.message);
      throw missingProviderError();
    }
  }
  throw missingProviderError();
}
