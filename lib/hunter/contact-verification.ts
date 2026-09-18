const VERIFIED_EMAIL_STATUSES = new Set(["verified", "valid", "deliverable"]);

export function hasVerifiedWorkEmail(
  email: string | null | undefined,
  status: string | null | undefined,
) {
  const address = String(email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return false;
  const normalized = String(status || "").trim().toLowerCase();
  return VERIFIED_EMAIL_STATUSES.has(normalized);
}
