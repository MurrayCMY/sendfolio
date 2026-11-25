# Architecture

```
src/                 Preact front end (admin at /admin, reader at /<link-address>)
  i18n.ts            t("English text") + locales/zh.ts
  visitor/           the reader: gate, NDA step, page canvas, tracking
  pages/ admin/      the admin area
server/
  handlers/          portable HTTP handlers: admin.ts, visitor.ts, scheduled.ts (Request -> Response)
  lib/               db, storage, mail, emails, pdf (NDA + watermark), stats, auth, rate limiting
  index.ts           Node server: static files + the two handlers + migrations + the 10-minute job
netlify/
  functions/         thin wrappers that mount the same handlers on Netlify
  database/migrations/  SQL migrations (shared by every target)
```

## One code base, three runtimes

The handlers take a standard `Request` and return a `Response`. `server/index.ts` mounts them on Node's HTTP server;
`netlify/functions/*.mts` mount them on Netlify. What differs between environments sits behind two small interfaces:

- **Database** (`server/lib/db.ts`): `db.sql` tagged template, `db.pool.connect()` for transactions. Drivers: node-postgres (`DATABASE_URL` /
  Netlify Database) or embedded PGlite.
- **Files** (`server/lib/storage.ts`): `get / set / delete / exists / list`. Drivers: local folder or Netlify Blobs.

## Data model (see the migration)

`documents` → `document_versions` (page count, status) → `links` (per-recipient settings) → `visits` → `page_views` (ms per page).
`visitors` (one per email, with follow-up status and note) and `nda_acceptances` (snapshot of the signed text hash, IP, time, mail state).
`otp_codes` and `rate_events` back verification codes and rate limits. `settings` holds admin-editable values.

## Reading and tracking

1. The browser renders each PDF page to a WebP image (pdf.js) and uploads it; the original PDF is stored for optional watermarked download.
2. The visitor passes the gate (email code, optional password/NDA), then `open` returns a visit id and the watermark text.
3. The reader draws page image + watermark on a canvas. Every 5 seconds a heartbeat reports the page and whether the reader was active
   (page visible, window focused, input in the last 30 s). The server credits at most 5 s per beat and never more than the real elapsed time.
4. A visit ends after 15 minutes without a heartbeat; the scheduled job then emails a summary.

## Security notes

- Cookies: HMAC-signed, HttpOnly, SameSite=Lax (and Secure when `SITE_URL` is https); state-changing requests also check the Origin header.
- Admin login: email code (hashed at rest, 10-minute expiry, attempt limits) for a single configured address.
- Rate limits: codes per address and IP, password attempts, downloads, test mail. Stored in `rate_events`.
- Pages are images produced in the browser. The server only parses a PDF when it builds a watermarked download of a file you uploaded yourself.
- Migrations are checksummed and additive.

## Tests

`npm test` runs an end-to-end smoke test against a running instance (see `scripts/smoke-test.mjs`); CI runs it on PGlite and on PostgreSQL,
and builds the Docker image.
