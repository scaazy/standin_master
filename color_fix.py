# Color correction only (no upscale): white balance + yellow/green desat + highlight rolloff.
import cv2
import numpy as np
import sys

inp = sys.argv[1]
out = sys.argv[2]

img = cv2.imread(inp, cv2.IMREAD_COLOR)
if img is None:
    raise SystemExit("cannot read " + inp)

f = img.astype(np.float32)
means = f.reshape(-1, 3).mean(axis=0)
gray = means.mean()
gain = gray / np.maximum(means, 1.0)
gain = 1.0 + (gain - 1.0) * 0.6
wb = np.clip(f * gain, 0, 255)

hsv = cv2.cvtColor(wb.astype(np.uint8), cv2.COLOR_BGR2HSV).astype(np.float32)
hh, ss, vv = cv2.split(hsv)
mask_y = np.exp(-((hh - 30) ** 2) / (2 * 12 ** 2))
mask_g = np.exp(-((hh - 60) ** 2) / (2 * 15 ** 2))
ss = ss * (1 - 0.10 * mask_y) * (1 - 0.06 * mask_g)
ss = np.clip(ss, 0, 255)
wb = cv2.cvtColor(cv2.merge([hh, ss, vv]).astype(np.uint8), cv2.COLOR_HSV2BGR).astype(np.float32)

v = wb / 255.0
hi = np.clip(v - 0.78, 0, None)
v = v - hi * 0.35
wb = np.clip(v * 255.0, 0, 255).astype(np.uint8)

cv2.imwrite(out, wb, [cv2.IMWRITE_JPEG_QUALITY, 95])
print("saved:", out, wb.shape[1], "x", wb.shape[0])
