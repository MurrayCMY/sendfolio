# Configuration reference

All settings are environment variables. Locally they come from `.env` (create it with `npm run init`); on Docker, Netlify and
other platforms set them in the platform. Real environment variables take precedence over `.env`.

## Required

| Variable | Description |
|---|---|
| `SESSION_SECRET` | 32+ random characters. Signs login cookies and tokens. Changing it signs everyone out. |
| `ADMIN_EMAIL` | Primary admin address allowed to sign in to `/admin` (supports comma-separated addresses; additional teammates can also be added in **Settings → Team**). |
| `SITE_URL` | Public address without a trailing slash, e.g. `https://docs.example.com`. Used for links inside emails. |

## Branding and language

| Variable | Default | Description |
|---|---|---|
| `APP_NAME` | `SendFolio` | Shown in the UI, emails and PDFs. |
| `COMPANY_NAME` | `APP_NAME` | Organisation name used in the NDA text and confirmation emails. |
| `BRAND_COLOR` | `#141413` | Default accent colour (can also be customized in **Settings → Branding**). |
| `DEFAULT_LOCALE` | `en` | `en` or `zh`. Language of the admin and of emails to you, until someone picks another. Visitors whose browser prefers Chinese start in Chinese. |
| `TIMEZONE` | `UTC` | IANA name (`Asia/Shanghai`, `America/New_York`). Used for dates in the admin, emails, CSV exports and watermarks. |

## Email (SMTP)

| Variable | Default | Description |
|---|---|---|
| `SMTP_HOST` | | SMTP server. If empty, emails are printed to the server log instead of sent. |
| `SMTP_PORT` | `465` | `465` = implicit TLS, `587` = STARTTLS. |
| `SMTP_USER`, `SMTP_PASS` | | Credentials. |
| `MAIL_FROM` | `SMTP_USER` | Sender, e.g. `Acme Docs <docs@acme.com>`. Must be allowed by your provider. |
| `MAIL_BCC` | | Also send every NDA confirmation to this address. |

## Self-hosting

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8787` | HTTP port. |
| `DATABASE_URL` | | PostgreSQL connection string. Empty = embedded PGlite in `PGLITE_DIR`. |
| `PGLITE_DIR` | `./data/pglite` | Where the embedded database lives (only without `DATABASE_URL`). |
| `DB_POOL_SIZE` | `5` | Postgres connections. |
| `STORAGE_DIR` | `./data/files` | Where uploaded files are stored. |
| `STORAGE_DRIVER` | auto | `fs` (default), `s3` (automatic when `S3_BUCKET` is set), or `netlify` (automatic on Netlify). |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PREFIX` | | Optional S3-compatible object storage (Cloudflare R2, AWS S3, Aliyun OSS, MinIO). |
| `TRUST_PROXY` | `false` | `true` behind a reverse proxy/CDN: use `X-Forwarded-For` for the visitor IP (and Cloudflare's country header). Leave `false` if the app is exposed directly, otherwise visitors can fake their IP. |
| `HSTS` | `false` | Send `Strict-Transport-Security`. Enable once HTTPS works. |
| `MIGRATIONS_DIR` | `netlify/database/migrations` | Folder of SQL migrations. |

## Settings in the admin

Stored in the database and edited in **Admin → Settings**: branding (workspace name, logo, accent colour, reader action button), chat alerts (Slack, Feishu / Lark, generic webhooks), team admins, NDA versions, email delivery checks, and blocked personal-email domains. Per-link options (presets, expiry, password, watermark fields, NDA on/off, downloads, notifications) are set on each link.
