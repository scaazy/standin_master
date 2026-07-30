// Admin identity and access control.

export const ADMIN_OPEN_ID = process.env.ADMIN_OPEN_ID || "ou_e43f2359bd1e08d038dad47bce9916b4";

export function isAdmin(openId) {
  return openId === ADMIN_OPEN_ID;
}
