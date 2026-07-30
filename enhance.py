# Conservative photo restoration: denoise -> white balance -> 2x upscale -> unsharp.
import cv2
import numpy as np
import sys

inp = sys.argv[1] if len(sys.argv) > 1 else "input.jpg"
out_jpg = sys.argv[2] if len(sys.argv) > 2 else "restored.jpg"

img = cv2.imread(inp, cv2.IMREAD_COLOR)
if img is None:
    raise SystemExit("cannot read " + inp)
h, w = img.shape[:2]
print("input:", w, "x", h)

# 1. mild denoise at original resolution (fast on small images)
den = cv2.fastNlMeansDenoisingColored(img, None, h=4, hColor=4,
                                      templateWindowSize=7, searchWindowSize=21)

# 2. gray-world white balance, blended 60%, to tame yellow/green cast
f = den.astype(np.float32)
means = f.reshape(-1, 3).mean(axis=0)          # B, G, R
gray = means.mean()
gain = gray / np.maximum(means, 1.0)
gain = 1.0 + (gain - 1.0) * 0.6                # partial correction
wb = np.clip(f * gain, 0, 255)

# extra: slight desaturation of yellow/green in HSV
hsv = cv2.cvtColor(wb.astype(np.uint8), cv2.COLOR_BGR2HSV).astype(np.float32)
hh, ss, vv = cv2.split(hsv)
# OpenCV hue: green ~60, yellow ~30
mask_y = np.exp(-((hh - 30) ** 2) / (2 * 12 ** 2))   # yellow
mask_g = np.exp(-((hh - 60) ** 2) / (2 * 15 ** 2))   # green
ss = ss * (1 - 0.10 * mask_y) * (1 - 0.06 * mask_g)
ss = np.clip(ss, 0, 255)
hsv2 = cv2.merge([hh, ss, vv]).astype(np.uint8)
wb = cv2.cvtColor(hsv2, cv2.COLOR_HSV2BGR).astype(np.float32)

# 3. gentle highlight rolloff (compress >200 area)
v = wb / 255.0
hi = np.clip(v - 0.78, 0, None)
v = v - hi * 0.35
wb = np.clip(v * 255.0, 0, 255).astype(np.uint8)

# 4. 2x upscale, Lanczos
up = cv2.resize(wb, (w * 2, h * 2), interpolation=cv2.INTER_LANCZOS4)

# 5. unsharp mask, conservative
blur = cv2.GaussianBlur(up, (0, 0), sigmaX=1.1)
sharp = cv2.addWeighted(up, 1.45, blur, -0.45, 0)

# blend back 15% of pre-sharpen to keep it natural
sharp = cv2.addWeighted(sharp, 0.85, up, 0.15, 0)

cv2.imwrite(out_jpg, sharp, [cv2.IMWRITE_JPEG_QUALITY, 95])
print("saved:", out_jpg, sharp.shape[1], "x", sharp.shape[0])
