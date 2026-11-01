// PreRounds Founding Study Hall: email sign-in, schedule, and the video room.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";
import { SESSIONS, openSession, nextSession, describeSession, formatTime } from "/study-schedule.js";

const SUPABASE_URL = "https://chhkoajmaxjweugakhzm.supabase.co";
const SUPABASE_KEY = "sb_publishable_Oj-bEfguqOrt-5N-9pILLw_jhTFdI2r"; // public key
const STREAM_SDK = "https://esm.sh/@stream-io/video-client@1.61.2";
const VIDEO_TRACK = 2; // TrackType.VIDEO

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, detectSessionInUrl: true, flowType: "implicit" },
});

const $ = (sel) => document.querySelector(sel);
const intro = $("#sh-intro");
const room = $("#sh-room");
const views = { out: $('[data-view="signed-out"]'), in: $('[data-view="signed-in"]') };
const tiles = $("[data-tiles]");
const toast = $("[data-toast]");
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

let session = null;      // Supabase session
let client = null;       // Stream client
let call = null;         // Stream call
let joinInfo = null;     // response from /api/study-token
let blockTimer = null;
let unsubscribers = [];
const tileMap = new Map(); // sessionId -> { el, unbind }

// ---------- Schedule ----------
function renderSchedule() {
  $("[data-sessions]").innerHTML = SESSIONS.map((s) => `<li>${describeSession(s)}</li>`).join("");
  const status = $("[data-status]");
  const open = openSession();
  if (open) {
    status.innerHTML = open.startsIn > 0
      ? `<strong>Doors are open.</strong> The session starts in ${open.startsIn} min.`
      : `<strong>Open now</strong> until ${formatTime(open.end)} ET.`;
    status.classList.add("is-open");
  } else {
    const next = nextSession();
    const days = Math.floor(next.inMinutes / 1440);
    const hours = Math.floor((next.inMinutes % 1440) / 60);
    const mins = next.inMinutes % 60;
    const when = days ? `${days}d ${hours}h` : hours ? `${hours}h ${mins}m` : `${mins} min`;
    status.textContent = `Next session: ${next.label}, ${formatTime(next.start)} ET (in ${when}). Doors open 10 minutes early.`;
    status.classList.remove("is-open");
  }
}

// ---------- Sign-in ----------
function showSignedIn(s) {
  session = s;
  views.out.hidden = !!s;
  views.in.hidden = !s;
  if (s) {
    $("[data-who]").textContent = ` as ${s.user.email}`;
    const saved = store.get("sh-name") || s.user.user_metadata?.display_name || "";
    if (saved && !$("#sh-name").value) $("#sh-name").value = saved;
  }
}

supabase.auth.onAuthStateChange((_event, s) => showSignedIn(s));
supabase.auth.getSession().then(({ data }) => showSignedIn(data.session));

$("[data-signin]").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = e.target.email.value.trim();
  const note = $("[data-signin-note]");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    note.textContent = "Enter a valid email address.";
    note.className = "form-note is-error";
    return;
  }
  const button = e.target.querySelector("button");
  button.disabled = true;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${location.origin}/study`, shouldCreateUser: true },
  });
  button.disabled = false;
  if (error) {
    note.textContent = /rate|limit/i.test(error.message)
      ? "Too many sign-in emails just now. Please try again in a few minutes."
      : "We couldn't send the link. Please try again, or email hello@prerounds.org.";
    note.className = "form-note is-error";
  } else {
    note.textContent = `Check ${email} for your sign-in link. It may take a minute, and check spam just in case.`;
    note.className = "form-note is-success";
  }
});

$("[data-signout]").addEventListener("click", () => supabase.auth.signOut());

// ---------- Joining ----------
$("[data-join]").addEventListener("submit", async (e) => {
  e.preventDefault();
  const note = $("[data-join-note]");
  const name = e.target.name.value.trim();
  if (!name) { note.textContent = "Add the name others will see."; note.className = "form-note is-error"; return; }
  if (!e.target.agree.checked) { note.textContent = "Please confirm you're 18+ and agree to the rules."; note.className = "form-note is-error"; return; }
  store.set("sh-name", name);
  supabase.auth.updateUser({ data: { display_name: name } }).catch(() => {});

  const button = $("[data-join-button]");
  button.disabled = true;
  note.textContent = "Getting your seat…";
  note.className = "form-note";
  try {
    const { data } = await supabase.auth.getSession();
    const res = await fetch("/api/study-token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token}` },
      body: JSON.stringify({ name }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Couldn't get a seat. Please try again.");
    joinInfo = body;
    await enterRoom();
    note.textContent = "";
  } catch (err) {
    note.textContent = err.message;
    note.className = "form-note is-error";
    await cleanup();
  } finally {
    button.disabled = false;
  }
});

async function enterRoom() {
  const { StreamVideoClient } = await import(STREAM_SDK);
  client = new StreamVideoClient({ apiKey: joinInfo.apiKey, user: joinInfo.user, token: joinInfo.token });
  call = client.call(joinInfo.call.type, joinInfo.call.id);
  await call.microphone.disable();
  await call.join({ create: false });
  call.setViewport(tiles);

  intro.hidden = true;
  room.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });

  try { await call.camera.enable(); } catch { showToast("Camera blocked. Allow camera access in your browser to be seen."); }

  unsubscribers.push(
    call.state.participants$.subscribe(renderTiles),
    call.camera.state.status$.subscribe((status) => {
      const btn = $("[data-camera]");
      const on = status === "enabled";
      btn.textContent = on ? "Turn camera off" : "Turn camera on";
      btn.setAttribute("aria-pressed", String(on));
    }),
    call.state.callingState$.subscribe((state) => {
      if (state === "left" && !room.hidden) exitRoom("You've left the Study Hall.");
    }),
  );
  const offKick = call.on("call.kicked_user", (event) => {
    if (event.user?.id === joinInfo.user.id) exitRoom("The host removed you from this session.");
  });
  unsubscribers.push({ unsubscribe: offKick });

  restoreGoal();
  startBlockTimer();
}

// ---------- Tiles ----------
function renderTiles(participants) {
  const seen = new Set();
  for (const p of participants) {
    seen.add(p.sessionId);
    let entry = tileMap.get(p.sessionId);
    if (!entry) {
      const el = document.createElement("div");
      el.className = "sh-tile";
      el.innerHTML = `
        <video playsinline muted autoplay></video>
        <span class="sh-initial" aria-hidden="true"></span>
        <span class="nm"></span>
        <span class="sh-tile-goal" hidden></span>
        <div class="sh-tile-actions"></div>`;
      const video = el.querySelector("video");
      const unbind = call.bindVideoElement(video, p.sessionId, "videoTrack");
      entry = { el, unbind };
      tileMap.set(p.sessionId, entry);
      if (p.isLocalParticipant) tiles.prepend(el); else tiles.append(el);

      if (!p.isLocalParticipant) {
        const actions = el.querySelector(".sh-tile-actions");
        const report = document.createElement("button");
        report.type = "button";
        report.textContent = "Report";
        report.addEventListener("click", () => openReport(p.userId, p.name || "this member"));
        actions.append(report);
        if (joinInfo.isHost) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "Remove";
          remove.className = "danger";
          remove.addEventListener("click", async () => {
            remove.disabled = true;
            try { await call.kickUser({ user_id: p.userId, block: true }); showToast(`${p.name || "Member"} was removed.`); }
            catch { remove.disabled = false; showToast("Couldn't remove them. Try again."); }
          });
          actions.append(remove);
        }
      }
    }
    const name = p.isLocalParticipant ? `You (${p.name || joinInfo.user.name})` : (p.name || "Member");
    entry.el.querySelector(".nm").textContent = name;
    entry.el.querySelector(".sh-initial").textContent = (p.name || "?").trim().charAt(0).toUpperCase();
    const hasVideo = (p.publishedTracks || []).includes(VIDEO_TRACK);
    entry.el.classList.toggle("no-video", !hasVideo);
    entry.el.classList.toggle("is-me", !!p.isLocalParticipant);
  }
  for (const [id, entry] of tileMap) {
    if (!seen.has(id)) { entry.unbind?.(); entry.el.remove(); tileMap.delete(id); }
  }
  $("[data-empty]").hidden = participants.length > 1;
  tiles.dataset.count = String(Math.min(participants.length, 9));
  renderGoalOnTile();
}

// ---------- Focus blocks ----------
function startBlockTimer() {
  clearInterval(blockTimer);
  const anchor = new Date();
  if (joinInfo.session) {
    // Anchor blocks to the session's start time (Eastern), so everyone shares the same timer.
    const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
    const length = toMin(joinInfo.session.end) - toMin(joinInfo.session.start);
    const elapsed = length - joinInfo.session.minutesLeft; // minutes since start (negative = early)
    anchor.setTime(Date.now() - elapsed * 60000 - new Date().getSeconds() * 1000);
  }
  const tick = () => {
    const secs = Math.floor((Date.now() - anchor.getTime()) / 1000);
    const label = $("[data-block]");
    const out = $("[data-block-timer]");
    if (secs < 0) {
      label.textContent = "Starting soon";
      out.textContent = fmt(-secs);
      return;
    }
    const inCycle = secs % 3600;
    if (inCycle < 3000) { label.textContent = "Focus block"; out.textContent = `${fmt(3000 - inCycle)} left`; }
    else { label.textContent = "Break"; out.textContent = `${fmt(3600 - inCycle)} left`; }
  };
  tick();
  blockTimer = setInterval(tick, 1000);
}
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// ---------- Goal (private to you, shown on your tile) ----------
const goalKey = () => `sh-goal-${new Date().toISOString().slice(0, 10)}`;
function restoreGoal() {
  const saved = JSON.parse(store.get(goalKey()) || "{}");
  $("[data-goal]").value = saved.text || "";
  setGoalDone(!!saved.done);
}
function saveGoal() {
  store.set(goalKey(), JSON.stringify({ text: $("[data-goal]").value.trim(), done: $("[data-goal-done]").getAttribute("aria-pressed") === "true" }));
  renderGoalOnTile();
}
function setGoalDone(done) {
  const btn = $("[data-goal-done]");
  btn.setAttribute("aria-pressed", String(done));
  btn.textContent = done ? "Done ✓" : "Mark done";
}
function renderGoalOnTile() {
  const me = [...tileMap.values()].find((t) => t.el.classList.contains("is-me"));
  if (!me) return;
  const text = $("[data-goal]").value.trim();
  const pill = me.el.querySelector(".sh-tile-goal");
  pill.hidden = !text;
  pill.textContent = ($("[data-goal-done]").getAttribute("aria-pressed") === "true" ? "✓ " : "") + text;
}
$("[data-goal]").addEventListener("input", saveGoal);
$("[data-goal-done]").addEventListener("click", () => {
  setGoalDone($("[data-goal-done]").getAttribute("aria-pressed") !== "true");
  saveGoal();
});

// ---------- Report ----------
let reporting = null;
function openReport(userId, name) {
  reporting = { userId, name };
  $("[data-report-name]").textContent = name;
  $("[data-report-panel]").hidden = false;
}
$("[data-report-cancel]").addEventListener("click", () => { $("[data-report-panel]").hidden = true; reporting = null; });
$("[data-report-send]").addEventListener("click", async () => {
  if (!reporting) return;
  const reason = $("[data-report-reason]").value;
  const { error } = await supabase.from("reports").insert({
    reported_user: reporting.userId.slice(0, 120),
    reported_name: reporting.name.slice(0, 120),
    reason,
  });
  $("[data-report-panel]").hidden = true;
  reporting = null;
  showToast(error ? "Couldn't send the report. Email hello@prerounds.org instead." : "Report sent. Thank you. The host will review it.");
});

// ---------- Controls ----------
$("[data-camera]").addEventListener("click", async () => {
  try { await call?.camera.toggle(); } catch { showToast("Couldn't access your camera."); }
});
$("[data-leave]").addEventListener("click", () => exitRoom("You've left the Study Hall. See you next time."));

async function exitRoom(message) {
  await cleanup();
  room.hidden = true;
  intro.hidden = false;
  const note = $("[data-join-note]");
  note.textContent = message || "";
  note.className = "form-note";
  renderSchedule();
}

async function cleanup() {
  clearInterval(blockTimer);
  unsubscribers.forEach((u) => { try { u.unsubscribe?.(); } catch {} });
  unsubscribers = [];
  for (const entry of tileMap.values()) { entry.unbind?.(); entry.el.remove(); }
  tileMap.clear();
  try { if (call && call.state.callingState !== "left") await call.leave(); } catch {}
  try { await client?.disconnectUser(); } catch {}
  call = null;
  client = null;
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => toast.classList.remove("show"), 4500);
}

window.addEventListener("beforeunload", () => { try { call?.leave(); } catch {} });

renderSchedule();
setInterval(renderSchedule, 30000);
