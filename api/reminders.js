// Study Hall reminder emails: turn on/off (signed-in members) and one-click unsubscribe.
//   GET  /api/reminders                 (Bearer token) -> { on: boolean }
//   POST /api/reminders { on: boolean } (Bearer token) -> { on: boolean }
//   GET  /api/reminders?unsubscribe=<token>            -> small confirmation page
//   POST /api/reminders?unsubscribe=<token>            -> one-click unsubscribe (mail apps)
import { verifyMember, db, SITE } from "../lib/server.js";

const UUID = /^[0-9a-f-]{36}$/i;

function page(res, title, message) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} | PreRounds</title>
<style>body{margin:0;background:#FBF8F3;color:#2B2340;font:17px/1.6 Georgia,serif;display:grid;place-items:center;min-height:100vh;padding:16px}main{max-width:460px;background:#fff;border:1px solid #E8E1F0;border-radius:20px;padding:28px}h1{font:800 1.4rem system-ui,sans-serif;margin:0 0 8px}a{color:#6B3FA0}</style></head>
<body><main><h1>${title}</h1><p>${message}</p><p><a href="${SITE}/study">Back to the Study Hall</a></p></main></body></html>`);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.SUPABASE_SECRET_KEY) return res.status(503).json({ error: "Reminders aren't set up yet." });

  // One-click unsubscribe from the email link.
  const token = String(req.query?.unsubscribe || "");
  if (token) {
    if (UUID.test(token)) {
      await db(`study_reminders?token=eq.${token}`, {
        method: "PATCH",
        body: { opted_in: false, updated_at: new Date().toISOString() },
        prefer: "return=minimal",
      });
    }
    if (req.method === "POST") return res.status(200).json({ ok: true });
    return page(res, "You're unsubscribed", "You won't get Study Hall reminder emails anymore. You can turn them back on anytime from the Study Hall page.");
  }

  const member = await verifyMember(req);
  if (!member) return res.status(401).json({ error: "Please sign in first." });

  if (req.method === "GET") {
    const { data } = await db(`study_reminders?user_id=eq.${member.id}&select=opted_in`);
    return res.status(200).json({ on: !!data?.[0]?.opted_in });
  }

  if (req.method === "POST") {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const on = !!body.on;
    const { ok } = await db("study_reminders?on_conflict=user_id", {
      method: "POST",
      body: { user_id: member.id, email: member.email.toLowerCase(), opted_in: on, updated_at: new Date().toISOString() },
      prefer: "resolution=merge-duplicates,return=minimal",
    });
    if (!ok) return res.status(500).json({ error: "Couldn't save that. Please try again." });
    return res.status(200).json({ on });
  }

  return res.status(405).json({ error: "Use GET or POST." });
}
