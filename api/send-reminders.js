// Sends the "Study Hall is tomorrow" email to members who turned reminders on.
//   GET  (Vercel Cron, Wednesday evening): sends once per session day.
//   POST (Bearer token of a host email): sends a test copy to that host only.
// Environment: SUPABASE_SECRET_KEY, RESEND_API_KEY, optional CRON_SECRET, HOST_EMAILS.
import { SESSIONS, easternNow, formatTime } from "../study-schedule.js";
import { verifyMember, hostEmails, db, SITE } from "../lib/server.js";

const FROM = "PreRounds <hello@prerounds.org>";

// Eastern calendar date (YYYY-MM-DD) for an instant.
const easternDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);

function tomorrowSessions() {
  const { day } = easternNow();
  const tomorrow = (day + 1) % 7;
  return SESSIONS.filter((s) => s.day === tomorrow);
}

function buildEmail(sessions, unsubscribeUrl) {
  const times = sessions.map((s) => `${formatTime(s.start)}–${formatTime(s.end)} ET`);
  const timesText = times.join(" and ");
  const subject = `Study Hall is tomorrow: ${times.map((t) => t.split("–")[0]).join(" and ")} ET`;
  const text = `The PreRounds Study Hall is tomorrow, ${timesText}.

Doors open 10 minutes early. Cameras on, microphones off, and a shared 50-minute focus timer. Bring one goal for the session.

Join here: ${SITE}/study

Add it to your calendar: ${SITE}/study-hall.ics

See you there,
PreRounds

You're getting this because you turned on Study Hall reminders. Unsubscribe: ${unsubscribeUrl}`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#FBF8F3;font-family:Georgia,serif;color:#2B2340">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #E8E1F0;border-radius:18px">
<tr><td style="height:5px;background:linear-gradient(90deg,#F06A8A,#B07CE8,#7FA8F0);border-radius:18px 18px 0 0;font-size:0">&nbsp;</td></tr>
<tr><td style="padding:28px 28px 8px">
<p style="margin:0 0 6px;font:800 13px system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#6B3FA0">Founding Study Hall</p>
<h1 style="margin:0 0 12px;font:800 24px/1.25 system-ui,sans-serif;color:#2B2340">See you tomorrow</h1>
<p style="margin:0 0 14px;font-size:17px;line-height:1.6">The Study Hall is open tomorrow, Thursday:</p>
${times.map((t) => `<p style="margin:0 0 6px;font:800 18px system-ui,sans-serif">${t}</p>`).join("")}
<p style="margin:14px 0 20px;font-size:16px;line-height:1.6;color:#4A4260">Doors open 10 minutes early. Cameras on, microphones off, and a shared 50-minute focus timer. Bring one goal for the session.</p>
<a href="${SITE}/study" style="display:inline-block;background:#2B2340;color:#ffffff;text-decoration:none;font:800 16px system-ui,sans-serif;padding:14px 26px;border-radius:999px">Go to the Study Hall</a>
<p style="margin:18px 0 0;font-size:15px"><a href="${SITE}/study-hall.ics" style="color:#6B3FA0">Add every Thursday to your calendar</a></p>
</td></tr>
<tr><td style="padding:20px 28px 26px;font-size:13px;line-height:1.5;color:#7A7290">Sessions are private and never recorded. You're getting this because you turned on Study Hall reminders. <a href="${unsubscribeUrl}" style="color:#7A7290">Unsubscribe</a></td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

async function sendBatch(recipients, sessions) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  let sent = 0;
  for (let i = 0; i < recipients.length; i += 100) {
    const chunk = recipients.slice(i, i + 100).map(({ email, token }) => {
      const unsubscribeUrl = `${SITE}/api/reminders?unsubscribe=${token}`;
      const { subject, text, html } = buildEmail(sessions, unsubscribeUrl);
      return {
        from: FROM,
        to: [email],
        subject,
        text,
        html,
        headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      };
    });
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
    sent += chunk.length;
  }
  return sent;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.SUPABASE_SECRET_KEY || !process.env.RESEND_API_KEY) {
    return res.status(503).json({ error: "Reminders aren't set up yet." });
  }
  const sessions = tomorrowSessions();

  // Host test: send one copy to the signed-in host.
  if (req.method === "POST") {
    const member = await verifyMember(req);
    if (!member || !hostEmails().includes(member.email.toLowerCase())) {
      return res.status(403).json({ error: "Hosts only." });
    }
    const preview = sessions.length ? sessions : SESSIONS.filter((s) => s.day === 4);
    const { data } = await db(`study_reminders?user_id=eq.${member.id}&select=token`);
    const token = data?.[0]?.token || "00000000-0000-0000-0000-000000000000";
    try {
      await sendBatch([{ email: member.email, token }], preview);
      return res.status(200).json({ sent: 1, to: member.email });
    } catch (err) {
      console.error(err);
      return res.status(502).json({ error: "Couldn't send the test email." });
    }
  }

  if (req.method !== "GET") return res.status(405).json({ error: "Use GET or POST." });

  // Scheduled run. If CRON_SECRET is set, require it.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "Unauthorized." });

  // Only the evening before a session day, so an early or repeated call can't spam anyone.
  const { minutes } = easternNow();
  if (!sessions.length || minutes < 12 * 60) return res.status(200).json({ skipped: "Not the evening before a session." });

  const sessionDate = easternDate(new Date(Date.now() + 24 * 3600 * 1000));
  const claim = await db("reminder_runs", { method: "POST", body: { run_date: sessionDate }, prefer: "return=minimal" });
  if (!claim.ok) return res.status(200).json({ skipped: `Already sent for ${sessionDate}.` });

  const { data: recipients } = await db("study_reminders?opted_in=eq.true&select=email,token");
  if (!recipients?.length) return res.status(200).json({ sent: 0 });
  try {
    const sent = await sendBatch(recipients, sessions);
    await db(`reminder_runs?run_date=eq.${sessionDate}`, { method: "PATCH", body: { sent_count: sent }, prefer: "return=minimal" });
    return res.status(200).json({ sent, sessionDate });
  } catch (err) {
    console.error(err);
    // Release the claim so a retry can send.
    await db(`reminder_runs?run_date=eq.${sessionDate}`, { method: "DELETE", prefer: "return=minimal" });
    return res.status(502).json({ error: "Sending failed." });
  }
}
