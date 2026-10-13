// PreRounds waitlist: inserts into Supabase (insert-only access; the list can't be read from here).
const SUPABASE_URL = "https://chhkoajmaxjweugakhzm.supabase.co";
const SUPABASE_KEY = "sb_publishable_Oj-bEfguqOrt-5N-9pILLw_jhTFdI2r"; // public, insert-only key

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Remember which ad or link brought the visitor (e.g. ?utm_source=instagram&utm_campaign=launch).
const params = new URLSearchParams(location.search);
const clean = (v) => (v || "").replace(/[^\w.-]/g, "").slice(0, 40);
const campaign = [clean(params.get("utm_source")), clean(params.get("utm_campaign")), clean(params.get("utm_content"))]
  .filter(Boolean).join("/");

// Preference picker: read the current choices and keep the "Your study room" card in sync.
const builder = document.getElementById("build");
function readPrefs() {
  if (!builder) return null;
  const pick = (name) => builder.querySelector(`input[name="${name}"]:checked`)?.value || null;
  const hours = [...builder.querySelectorAll('input[name="hours"]:checked')].map((i) => i.value);
  return { noise: pick("noise"), format: pick("format"), hours, match: pick("match") };
}
function renderPrefs() {
  const p = readPrefs();
  if (!p) return;
  const text = { noise: p.noise, format: p.format, hours: p.hours.length ? p.hours.join(", ") : "Any time", match: p.match };
  for (const [key, value] of Object.entries(text)) {
    const el = builder.querySelector(`[data-out="${key}"]`);
    if (el && el.textContent !== value) {
      el.textContent = value;
      el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
    }
  }
}
if (builder) builder.addEventListener("change", renderPrefs);

function setNote(form, text, kind) {
  const note = form.querySelector(".form-note");
  note.textContent = text;
  note.classList.remove("is-success", "is-error");
  if (kind) note.classList.add(kind);
}

document.querySelectorAll("form.waitlist").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = form.elements.email;
    const stage = form.elements.stage;
    const name = form.elements.first_name;
    const button = form.querySelector("button[type=submit]");

    // Bots fill the hidden field; quietly accept and do nothing.
    if (form.elements.website.value) { setNote(form, "You're on the list.", "is-success"); return; }

    email.removeAttribute("aria-invalid");
    stage.removeAttribute("aria-invalid");
    const emailValue = email.value.trim();
    if (!EMAIL_RE.test(emailValue)) {
      email.setAttribute("aria-invalid", "true");
      email.focus();
      setNote(form, "Enter a valid email address, like name@school.edu.", "is-error");
      return;
    }
    if (!stage.value) {
      stage.setAttribute("aria-invalid", "true");
      stage.focus();
      setNote(form, "Choose where you are now so we can match you well.", "is-error");
      return;
    }

    const where = form.dataset.source || "site";
    const body = { email: emailValue, stage: stage.value, source: (campaign ? `${campaign}|${where}` : where).slice(0, 100) };
    if (name && name.value.trim()) body.first_name = name.value.trim().slice(0, 80);
    if (form.hasAttribute("data-prefs")) body.preferences = readPrefs();

    button.disabled = true;
    const label = button.textContent;
    button.textContent = "Joining…";
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/waitlist`, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(body),
      });
      if (res.status === 201) {
        form.reset();
        setNote(form, form.hasAttribute("data-prefs")
          ? "Your spot and preferences are saved. We'll email you when early access opens."
          : "You're on the list. We'll email you when early access opens.", "is-success");
      } else if (res.status === 409) {
        setNote(form, "This email is already on the waitlist.", "is-success");
      } else {
        setNote(form, "Couldn't join the waitlist. Try again in a moment, or email hello@prerounds.org.", "is-error");
      }
    } catch {
      setNote(form, "Couldn't reach the server. Check your connection and try again.", "is-error");
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });
});
