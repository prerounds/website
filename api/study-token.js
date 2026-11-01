// Issues a Study Hall video token to a member with a verified email,
// but only while a session is open (hosts can enter any time).
//
// Environment variables (set in Vercel, never in code):
//   STREAM_API_KEY     Stream app key (public)
//   STREAM_API_SECRET  Stream app secret (private)
//   HOST_EMAILS        comma-separated emails that host the room
import { StreamClient } from "@stream-io/node-sdk";
import { openSession } from "../study-schedule.js";

const SUPABASE_URL = "https://chhkoajmaxjweugakhzm.supabase.co";
const SUPABASE_KEY = "sb_publishable_Oj-bEfguqOrt-5N-9pILLw_jhTFdI2r"; // public, same as the site
const CALL_TYPE = "default";
const CALL_ID = "study-hall";

const clean = (s, max) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });

  const { STREAM_API_KEY, STREAM_API_SECRET, HOST_EMAILS = "" } = process.env;
  if (!STREAM_API_KEY || !STREAM_API_SECRET) {
    return res.status(503).json({ error: "The Study Hall isn't set up yet." });
  }

  // 1. Who is this? Ask Supabase to vouch for the signed-in member.
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return res.status(401).json({ error: "Please sign in first." });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_KEY, Authorization: auth },
  });
  if (!userRes.ok) return res.status(401).json({ error: "Your sign-in expired. Please sign in again." });
  const member = await userRes.json();
  if (!member?.email || !member.email_confirmed_at) {
    return res.status(403).json({ error: "Please confirm your email first." });
  }

  const email = member.email.toLowerCase();
  const hosts = HOST_EMAILS.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const isHost = hosts.includes(email);

  // 2. Is a session open?
  const session = openSession();
  if (!session && !isHost) {
    return res.status(403).json({ error: "The Study Hall is closed right now." });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const name = clean(body.name, 40) || "Member";
  const userId = `m_${member.id.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  // 3. Make sure they're on the waitlist too (ignore "already on the list").
  fetch(`${SUPABASE_URL}/rest/v1/waitlist`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ email, stage: "other", source: "studyhall", first_name: name.slice(0, 80) }),
  }).catch(() => {});

  // 4. Register them with Stream and issue a short-lived token.
  const stream = new StreamClient(STREAM_API_KEY, STREAM_API_SECRET);
  try {
    await stream.upsertUsers([{ id: userId, name, role: isHost ? "admin" : "user" }]);
    const call = stream.video.call(CALL_TYPE, CALL_ID);
    await call.getOrCreate({ data: { created_by_id: userId } });
  } catch (err) {
    console.error("Stream setup failed:", err?.message || err);
    return res.status(502).json({ error: "The video room isn't reachable right now. Please try again in a minute." });
  }

  const validity = (session ? session.minutesLeft + 30 : 180) * 60;
  const token = stream.generateUserToken({ user_id: userId, validity_in_seconds: validity });

  return res.status(200).json({
    apiKey: STREAM_API_KEY,
    token,
    user: { id: userId, name },
    call: { type: CALL_TYPE, id: CALL_ID },
    isHost,
    session: session ? { label: session.label, start: session.start, end: session.end, minutesLeft: session.minutesLeft } : null,
  });
}
