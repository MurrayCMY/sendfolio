# AGENTS.md — instructions for AI coding agents

This file is for agents such as Claude Code, Codex, Gemini CLI, Grok, Antigravity and Cursor.
If a human asked you to "deploy SendFolio" or "set this up", follow the runbook below. If they asked you to change code, read
"Working on the code" at the end.

## What this project is

SendFolio: self-hosted document sharing with per-page analytics, email-verified access, NDA gating and watermarks.
TypeScript. Front end: Preact + Vite (`src/`). Back end: portable request handlers (`server/`), run either by a small Node server
(`server/index.ts`, used by Docker and `npm start`) or by Netlify Functions (`netlify/functions/*.mts`, thin wrappers).
Database: PostgreSQL, or embedded PGlite when no `DATABASE_URL` is set. Files: local disk, or Netlify Blobs on Netlify.

## Rules that always apply

1. **Never print, log or commit secrets** (`SESSION_SECRET`, `SMTP_PASS`, `DATABASE_URL`). `.env` is git-ignored; keep it that way.
2. **Ask the human** for anything you cannot discover: admin email, public domain, SMTP credentials, which target to use. Do not invent them.
3. **Do not modify existing files in `netlify/database/migrations/`.** Add a new, later-dated file instead. Migrations must be additive (no drops or renames) so a deployed database is never harmed.
4. **Do not delete or overwrite the user's `data/` directory or database** unless they explicitly ask.
5. Prefer the verification commands below over assuming success. Report failures with the real output.

## Questions to ask before deploying

- Which target? (Docker on a server, Netlify, Railway/Render/Fly, or just run it locally.)
- Admin email: the only address that may sign in to `/admin`.
- Public address, e.g. `https://docs.example.com` (and, for a server, can they point a DNS A record at it?).
- Email (SMTP) provider and credentials. Without SMTP everything works but emails are printed in the server log; visitors cannot receive codes, so it is only fine for a trial. Suggest Resend or Gmail (app password) for the quickest path.
- Language (`en` or `zh`) and time zone (e.g. `UTC`, `America/New_York`, `Asia/Shanghai`).
- Optional: app name, company name (used in the NDA and emails).

## Runbook A — Docker Compose on a server (recommended)

Needs: a server with Docker + Compose plugin, ports 80/443 open for HTTPS, a domain pointing at the server.

```bash
git clone <repo-url> sendfolio && cd sendfolio
cp .env.example .env
# fill: ADMIN_EMAIL, SITE_URL (https://your.domain), SMTP_*, APP_NAME, DEFAULT_LOCALE, TIMEZONE, HSTS=true
# generate the secret:  node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"
#   (or, with no Node installed: openssl rand -base64 36 | tr '+/' '-_' | tr -d '=')  -> SESSION_SECRET
echo "DOMAIN=your.domain" >> .env
docker compose --profile https up -d --build      # app + Postgres + automatic HTTPS (Caddy)
```

Without a domain yet: `docker compose up -d --build` serves plain HTTP on `127.0.0.1:8787` (set `BIND=0.0.0.0` in `.env` to expose it).

Verify:
```bash
docker compose ps                                   # app and db healthy
curl -fsS https://your.domain/healthz               # {"ok":true,"db":"postgres"}
npm run doctor                                      # on the host, with the same .env: checks SMTP login, config, ports
```
Then open `https://your.domain/admin`, sign in with the admin email (the code arrives by email), upload a PDF, create a link.
Updating later: `git pull && docker compose up -d --build` (migrations run automatically on start).

## Runbook B — Netlify

Needs: a Netlify account and the repository on GitHub (or the Netlify CLI logged in).

1. Create a site from the repository (Netlify detects `netlify.toml`; build command `npm run build:web`, publish `dist`).
2. Provide a database, one of:
   - **Netlify Database** (adds `NETLIFY_DB_URL`; Netlify applies `netlify/database/migrations` on every deploy), or
   - any PostgreSQL: set `DATABASE_URL` (e.g. Neon, Supabase). The app applies its own migrations on cold start.
3. Set environment variables (Site configuration → Environment variables): `SESSION_SECRET`, `ADMIN_EMAIL`, `SITE_URL` (the site's public URL), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `APP_NAME`, `DEFAULT_LOCALE`, `TIMEZONE`.
4. Add the custom domain if wanted, then redeploy.
5. Verify: `curl -fsS $SITE_URL/api/v/_/config` returns JSON with `app_name`; open `$SITE_URL/admin`.

Notes: files use Netlify Blobs automatically. The 10-minute background job is the scheduled function in `netlify/functions/scheduled.mts`.
Each production deploy consumes Netlify credits; test locally first (`npm run build && npm start`).

## Runbook C — Railway / Render / Fly.io (any Docker PaaS)

1. Create a service from the repository using the `Dockerfile` (port 8787, health check `/healthz`).
2. Add a managed PostgreSQL and set `DATABASE_URL` from it.
3. Attach a persistent volume mounted at `/app/data` (page images and signed PDFs live in `/app/data/files`).
4. Set the same variables as in Runbook A, plus `TRUST_PROXY=true` and `HSTS=true`.
5. Verify with `curl -fsS https://<service-url>/healthz`.
These platforms are not tested by the maintainers; if something differs, adapt and tell the human what you changed.

## Runbook D — plain Node (laptop or small server)

```bash
npm install
npm run init -- --admin-email <email> --site-url <url> --yes   # creates .env with a random SESSION_SECRET
npm run build
npm start                                                       # http://localhost:8787
```
Keep it running with a process manager (systemd, pm2). Use PostgreSQL (`DATABASE_URL`) if it matters.

## Verifying any deployment

```bash
npm run doctor              # human-readable checklist with fixes
npm run doctor -- --json    # machine-readable: {"ok": bool, "results":[{"id","level","message","fix"}]}
npm test -- --log <server.log> --base <url>   # end-to-end smoke test against a RUNNING server whose log shows emails
```
The smoke test reads login codes from the server log, so it only works when SMTP is **not** configured (a local or CI instance).
Never run it against a production instance with real data.

## Common problems

| Symptom | Cause / fix |
|---|---|
| Login code never arrives | SMTP not configured or wrong. With no SMTP the code is in the server log (`docker compose logs app`). Check `npm run doctor`. |
| `SESSION_SECRET is missing or shorter than 32 characters` | Run `npm run init` or set a 32+ character random value. |
| `Migration ... was modified after it was applied` | Someone edited an applied migration. Restore it (`git checkout`), add a new migration instead. |
| Visitor IPs are all the proxy's IP | Set `TRUST_PROXY=true` when running behind a reverse proxy/CDN. |
| Emails land in spam | Set up SPF, DKIM and DMARC for the sending domain; use the Settings → Email & domain check in the admin. |
| Netlify build fails on the database | Provision Netlify Database or set `DATABASE_URL`; confirm migrations are in `netlify/database/migrations`. |
| Cannot upload large PDFs | Page images are uploaded one request each; make sure a reverse proxy allows request bodies of at least 12 MB. |

## Working on the code

- Commands: `npm run dev` (hot reload, API on :8787, UI on :5173), `npm run typecheck`, `npm run i18n:check`, `npm run build`, `npm test` (needs a running server, see above), `npm run demo`.
- Layout: `src/` UI · `src/locales/zh.ts` Chinese translations · `server/handlers/` HTTP handlers · `server/lib/` logic (db, storage, mail, pdf, stats) · `server/index.ts` Node entry · `netlify/` Netlify wrappers and migrations · `scripts/` tooling · `docs/`.
- UI text: write English in `t("...")` and add the Chinese in `src/locales/zh.ts`. Server error messages are English; the browser translates them through the same file. Run `npm run i18n:check`.
- Database: add `netlify/database/migrations/<yyyymmddhhmmss>_<name>.sql`, additive only. Never edit applied files.
- Keep the code free of any company-specific names, domains, emails or data; use `APP_NAME` / `COMPANY_NAME` and example.com addresses.
- Before finishing: `npm run typecheck && npm run i18n:check && npm run build`, and run the smoke test against a local instance.
