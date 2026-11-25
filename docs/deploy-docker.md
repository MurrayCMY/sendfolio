# Deploy with Docker Compose (VPS or any server)

The recommended way. One command starts the app, a PostgreSQL database and, optionally, automatic HTTPS.
Works on any Linux server with Docker: DigitalOcean, Hetzner, AWS Lightsail, Alibaba Cloud, Tencent Cloud, a Raspberry Pi at home...
A 1 GB RAM server is enough.

## 1. Prepare

- A server with [Docker Engine and the Compose plugin](https://docs.docker.com/engine/install/).
- A domain name with an **A record** pointing at the server's IP (for HTTPS). You can start without one.
- An SMTP account for sending email (see "Email" below).

> **Servers in mainland China:** serving a domain from mainland China requires an ICP filing (备案), and hosting other people's
> uploads brings content-compliance duties. If you do not want that, use a Hong Kong or Singapore region.

## 2. Configure

```bash
git clone https://github.com/MurrayCmy/sendfolio.git
cd sendfolio
cp .env.example .env
```

Edit `.env`:

```ini
SESSION_SECRET=<32+ random characters>      # openssl rand -base64 36
ADMIN_EMAIL=you@yourcompany.com
SITE_URL=https://docs.yourcompany.com
HSTS=true
APP_NAME=Acme Docs                          # optional
DEFAULT_LOCALE=en                           # or zh
TIMEZONE=America/New_York                   # IANA name
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=re_xxxxxxxx
MAIL_FROM=Acme Docs <docs@yourcompany.com>
DOMAIN=docs.yourcompany.com                 # used by the HTTPS proxy
POSTGRES_PASSWORD=<another random value>    # optional, defaults to "sendfolio"; the database is not exposed
```

## 3. Start

```bash
docker compose --profile https up -d --build
```

This starts `app`, `db` (PostgreSQL) and `caddy`, which obtains and renews a Let's Encrypt certificate for `DOMAIN` automatically
(ports 80 and 443 must be reachable). Open `https://docs.yourcompany.com/admin`.

No domain yet? `docker compose up -d --build` serves plain HTTP on `127.0.0.1:8787`; put `BIND=0.0.0.0` in `.env` to reach it from outside.
Already have a reverse proxy (nginx, Traefik, Cloudflare Tunnel)? Skip the `https` profile and proxy to port 8787, keep `TRUST_PROXY=true`,
and allow request bodies of 12 MB or more.

## 4. Check

```bash
docker compose ps                       # app and db should be "healthy"/"running"
curl -fsS https://docs.yourcompany.com/healthz
docker compose logs -f app
```

Sign in at `/admin` (the code is emailed to `ADMIN_EMAIL`), upload a PDF, create a link and open it in a private window.

## Email

Any SMTP provider works. Quick options:

| Provider | Settings |
|---|---|
| Resend | `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=465`, `SMTP_USER=resend`, `SMTP_PASS=<API key>` (verify your domain first) |
| Gmail | `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=you@gmail.com`, `SMTP_PASS=<app password>` |
| Postmark / SES / Mailgun / Brevo | their SMTP credentials |

Without SMTP, codes are printed in `docker compose logs app`, which is fine for a first look but not for real visitors.
After sending a test (Admin → NDA & settings → Email & domain), check that it did not land in spam; set up SPF, DKIM and DMARC for your domain.

## Backups

Everything lives in two Docker volumes: `db-data` (the database) and `app-data` (page images and signed PDFs).

```bash
docker compose exec db pg_dump -U sendfolio sendfolio | gzip > sendfolio-$(date +%F).sql.gz
docker run --rm -v sendfolio_app-data:/data -v "$PWD":/backup alpine tar czf /backup/files-$(date +%F).tgz -C /data .
```

## Updating

```bash
git pull
docker compose --profile https up -d --build
```

Database migrations run automatically on start and are additive.
