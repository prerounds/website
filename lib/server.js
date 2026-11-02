// Shared server helpers for the Study Hall functions.
export const SUPABASE_URL = "https://chhkoajmaxjweugakhzm.supabase.co";
export const SUPABASE_KEY = "sb_publishable_Oj-bEfguqOrt-5N-9pILLw_jhTFdI2r"; // public, same as the site
export const SITE = "https://prerounds.org";

// Ask Supabase who owns this sign-in token. Returns the member or null.
export async function verifyMember(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_KEY, Authorization: auth },
  });
  if (!res.ok) return null;
  const member = await res.json();
  if (!member?.email || !member.email_confirmed_at) return null;
  return member;
}

export function hostEmails() {
  return (process.env.HOST_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

// Server-only database access (bypasses row security). Needs SUPABASE_SECRET_KEY.
export async function db(path, { method = "GET", body, prefer } = {}) {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set");
  const headers = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`; // legacy service_role JWT
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { ok: res.ok, status: res.status, data };
}
