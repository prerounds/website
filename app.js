// PreRounds waitlist: inserts into Supabase (insert-only access; the list can't be read from here).
const SUPABASE_URL = "https://chhkoajmaxjweugakhzm.supabase.co";
const SUPABASE_KEY = "sb_publishable_Oj-bEfguqOrt-5N-9pILLw_jhTFdI2r"; // public, insert-only key

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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

    const body = { email: emailValue, stage: stage.value, source: form.dataset.source || "site" };
    if (name && name.value.trim()) body.first_name = name.value.trim().slice(0, 80);

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
        setNote(form, "You're on the list. We'll email you when early access opens.", "is-success");
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
