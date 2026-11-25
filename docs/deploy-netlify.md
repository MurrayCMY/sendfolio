# Deploy on Netlify

No server to maintain: the front end is static, the API runs as Netlify Functions, a scheduled function runs the background job,
files go to Netlify Blobs, and the database is Netlify Database (PostgreSQL) or any Postgres you bring.

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/MurrayCmy/sendfolio)

## Steps

1. **Create the site.** Click the button above (or "Add new site → Import from Git" with your fork). Netlify reads `netlify.toml`
   (build `npm run build:web`, publish `dist`).
2. **Database.** Either
   - enable **Netlify Database** for the site. Netlify injects `NETLIFY_DB_URL` and applies `netlify/database/migrations` on every deploy; or
   - use any PostgreSQL (Neon, Supabase ...) and set `DATABASE_URL`. SendFolio applies its own migrations on the first request after a deploy.
3. **Environment variables** (Site configuration → Environment variables):

   | Variable | Value |
   |---|---|
   | `SESSION_SECRET` | 32+ random characters (`openssl rand -base64 36`) |
   | `ADMIN_EMAIL` | the only address that can sign in to `/admin` |
   | `SITE_URL` | the site's public address, e.g. `https://docs.example.com` |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | your SMTP provider |
   | `APP_NAME`, `DEFAULT_LOCALE`, `TIMEZONE`, `COMPANY_NAME` | optional branding and locale |

4. **Domain.** Add your custom domain under Domain management (optional) and update `SITE_URL`.
5. **Deploy**, then open `/admin`.

## Good to know

- **Credits.** Each production deploy and all function/bandwidth use count against your Netlify plan. Test locally first
  (`npm run build && npm start`) and batch your changes into fewer deploys.
- **Function limits.** Netlify functions have time and payload limits. SendFolio uploads page images one request each and runs
  at most a few background items per job for this reason.
- **Files.** Stored in Netlify Blobs automatically (`STORAGE_DRIVER=netlify` is chosen when running on Netlify).
- **The background job** (reading summaries, NDA email retries) is `netlify/functions/scheduled.mts`, every 10 minutes.
- **Deploy previews** use the same database unless you configure branches; avoid testing with real visitors there.
- Prefer a server? See [deploy-docker.md](deploy-docker.md).
