<div align="center">

# SendFolio

**Share documents. See who reads them, page by page.**
A free, self-hosted, open-source alternative to DocSend, built for founders.

[![CI](https://github.com/MurrayCmy/sendfolio/actions/workflows/ci.yml/badge.svg)](https://github.com/MurrayCmy/sendfolio/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[English](README.md) · [简体中文](README.zh-CN.md)

</div>

You are raising money, selling to enterprises, or running a data room. You send a deck as a PDF and then... nothing.
Did they open it? Which pages did they read? Did they forward it?

SendFolio gives each recipient their own link, asks them to verify their email, optionally has them sign an NDA, shows the
document in the browser with their name watermarked on every page, and tells you exactly how long they spent on each page.
You run it yourself, on your own domain, and your documents and your readers' data stay with you.

<p align="center">
  <img src="docs/images/overview.png" alt="Admin overview" width="860">
</p>

<table>
  <tr>
    <td><img src="docs/images/reader.png" alt="What a recipient sees: the page with their name watermarked"></td>
    <td><img src="docs/images/analytics.png" alt="Per-page reading heat map"></td>
  </tr>
  <tr>
    <td align="center"><sub>What the recipient sees: the page, with their name watermarked</sub></td>
    <td align="center"><sub>Per-page reading time across all readers</sub></td>
  </tr>
</table>

## Features

- **A personal link per recipient**, with a custom address (`yourdomain.com/acme`), an optional expiry date and an optional password. Disable or delete a link at any time.
- **Reading analytics**: time on every page, how far they got, a heat map across all readers, return visits, device and location, and a live "reading now" marker.
- **Follow-up inbox**: see who came back or read deeply, set a follow-up status and keep private notes per person.
- **Email-verified access**: visitors enter their name and work email and confirm a 6-digit code. Block personal email domains or allow only specific company domains.
- **NDA gate with e-signature**: visitors accept your NDA before they see anything. Each acceptance produces a PDF (agreement plus a signing record with time, IP and a hash of the exact text) and emails a copy to the signer.
- **Dynamic watermark** with the viewer's name, email, IP and time, baked into the page image (and into downloaded PDFs). You choose which fields appear.
- **Pages are served as images**, not as the PDF, with a tamper guard. Optional watermarked PDF download.
- **Notifications**: an email when someone opens a link and a reading summary when they finish.
- **Two languages**: English and 简体中文, for the admin, the reader, emails and PDFs. Easy to add more.
- **Runs anywhere**: Docker, a VPS, Netlify, or `npm start` on your laptop. No vendor lock-in.

## Try it in two minutes

You need Node.js 22 or newer.

```bash
git clone https://github.com/MurrayCmy/sendfolio.git
cd sendfolio
npm install
npm run init -- --admin-email you@example.com   # creates .env with a fresh secret
npm run build
npm run demo      # optional: fills in made-up sample data so there is something to look at
npm start
```

Open <http://localhost:8787/admin>. The sign-in code is printed in the terminal (email is not configured yet).
The demo data includes a sample link at <http://localhost:8787/acme>.

This uses an embedded database and local files, which is perfect for trying things out. For real use, pick one of the options below.

## Deploy it for real

| Option | Best for | Database | Files | Guide |
|---|---|---|---|---|
| **Docker Compose** | Any VPS or home server. Recommended. | PostgreSQL (included) | Docker volume | [docs/deploy-docker.md](docs/deploy-docker.md) |
| **Netlify** | No server to look after | Netlify Database or any Postgres | Netlify Blobs | [docs/deploy-netlify.md](docs/deploy-netlify.md) |
| **Railway, Render, Fly.io, ...** | Managed container hosting | Their managed Postgres | A mounted volume | [docs/deploy-paas.md](docs/deploy-paas.md) |
| **Plain Node.js** (`npm start`) | Laptops, tiny servers | Embedded PGlite or Postgres | Local folder | this page |

Whichever you choose, you need: a domain (or subdomain), an SMTP account for sending email (Resend, Gmail, Postmark, SES ... anything
SMTP), and ten minutes.

### Let an AI agent do it

SendFolio is built to be deployed by coding agents (Claude Code, Codex, Gemini CLI, Grok, Antigravity, Cursor ...). Open the folder in your agent
and paste:

> Deploy SendFolio from this repository to **\[Docker on my VPS / Netlify / Railway]**. Follow `AGENTS.md`. Ask me for anything
> you cannot find out yourself (admin email, domain, SMTP credentials). When finished, run `npm run doctor` and `npm test`
> and tell me the admin URL.

[`AGENTS.md`](AGENTS.md) contains the step-by-step runbook for every target, what to ask you, and how to verify the result.
`npm run doctor -- --json` gives an agent a machine-readable health check.

## Configuration

Everything is configured with environment variables; [`.env.example`](.env.example) documents each one.
The important ones: `ADMIN_EMAIL`, `SITE_URL`, `SESSION_SECRET`, `SMTP_*`, `APP_NAME`, `DEFAULT_LOCALE` (`en` or `zh`), `TIMEZONE`.
See [docs/configuration.md](docs/configuration.md), and [docs/customization.md](docs/customization.md) for your own name, colours,
logo, NDA text and languages.

## How it works

```
 Browser (Preact)  ──►  Node server / Netlify Functions  ──►  PostgreSQL (or embedded PGlite)
 admin + reader          admin API · visitor API · job         visits, page views, NDAs ...
                                   │
                                   └──►  File storage (disk volume or Netlify Blobs): page images, signed PDFs
```

- Uploading happens in your browser: it renders each PDF page to an image and uploads those, so readers only ever receive images.
- The reader draws the page image and the watermark on one canvas. Time is counted with a 5-second heartbeat that only
  advances while the page is visible, focused and in use.
- A background job (every 10 minutes) sends reading summaries and retries failed NDA emails.

More in [docs/architecture.md](docs/architecture.md).

## Privacy and security

- Recipients are told what is recorded: name, email, time, IP address, device and time per page.
- Sessions use signed, HttpOnly cookies; login codes are rate limited; the admin area accepts a single email address.
- Read [SECURITY.md](SECURITY.md) for the threat model, limits (a watermark deters leaks, it cannot stop a photo of a screen) and how to report a vulnerability.
- **The included NDA is a sample template, not legal advice.** Have a lawyer approve the text you actually use.

## Status

SendFolio is young (v0.1). It is used in production by its authors, and the deployment paths marked "Recommended" are tested in CI.
Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache License 2.0](LICENSE). The name and logo are covered by [TRADEMARKS.md](TRADEMARKS.md).
Third-party notices are in [NOTICE](NOTICE).
