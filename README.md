# PreRounds website

Landing page and waitlist for [prerounds.org](https://prerounds.org), the virtual study room for future doctors.

- Static site: `index.html`, `styles.css`, `app.js`
- Hosted on Vercel; DNS on Cloudflare
- Waitlist signups go to the `waitlist` table in Supabase (insert-only from the site; the list is readable only from the Supabase dashboard)
