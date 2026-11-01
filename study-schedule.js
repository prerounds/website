// Founding Study Hall schedule, shared by the study page and the server.
// Times are US Eastern. Change sessions here and both sides follow.
export const STUDY_TIMEZONE = "America/New_York";

export const SESSIONS = [
  { day: 4, start: "09:00", end: "11:00", label: "Thursday morning" },
  { day: 4, start: "20:00", end: "22:00", label: "Thursday night" },
];

// Doors open this many minutes before a session starts.
export const EARLY_MINUTES = 10;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// Day of week and minutes since midnight in Eastern time for a given instant.
export function easternNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: STUDY_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

// The session that is open right now (including the early-entry window), or null.
export function openSession(date = new Date()) {
  const { day, minutes } = easternNow(date);
  for (const s of SESSIONS) {
    if (s.day !== day) continue;
    const start = toMinutes(s.start);
    const end = toMinutes(s.end);
    if (minutes >= start - EARLY_MINUTES && minutes < end) {
      return { ...s, minutesLeft: end - minutes, startsIn: Math.max(0, start - minutes) };
    }
  }
  return null;
}

// Minutes until the next session starts (from now), plus that session.
export function nextSession(date = new Date()) {
  const { day, minutes } = easternNow(date);
  let best = null;
  for (const s of SESSIONS) {
    let delta = (s.day - day) * 1440 + toMinutes(s.start) - minutes;
    if (delta <= 0) delta += 7 * 1440;
    if (!best || delta < best.inMinutes) best = { ...s, inMinutes: delta };
  }
  return best;
}

export function formatTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${suffix}` : `${h12} ${suffix}`;
}

export function describeSession(s) {
  return `${DAY_NAMES[s.day]}s, ${formatTime(s.start)}–${formatTime(s.end)} ET`;
}
