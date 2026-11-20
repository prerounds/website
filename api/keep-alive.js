// Backup keep-awake: Vercel runs this once a day (see vercel.json "crons").
// It asks the database for "1" so Supabase's free plan sees activity and
// never pauses the project. It reads nothing and changes nothing.
const SUPABASE_URL = "https://chhkoajmaxjweugakhzm.supabase.co";
const SUPABASE_KEY = "sb_publishable_Oj-bEfguqOrt-5N-9pILLw_jhTFdI2r"; // public, same as the site

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/keep_alive`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: "{}",
    });
    const ok = r.ok;
    if (!ok) console.error("Keep-alive failed: HTTP", r.status);
    return res.status(ok ? 200 : 502).json({ ok, status: r.status, at: new Date().toISOString() });
  } catch (err) {
    console.error("Keep-alive failed:", err?.message || err);
    return res.status(502).json({ ok: false, error: "Database not reachable" });
  }
}
