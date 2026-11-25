# Security

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private vulnerability reporting
(Security tab → "Report a vulnerability") on this repository. Include what you found, how to reproduce it and the impact.
We aim to acknowledge reports within a few days and to fix confirmed issues promptly. Please give us reasonable time before disclosing.

## What SendFolio protects, and what it does not

SendFolio raises the bar for casual leaking and gives you an audit trail. It is **not** digital rights management.

- ✅ Recipients get page *images*, not your PDF; the watermark is drawn into the pixels together with the page, and a guard hides the page if the watermark layer is tampered with.
- ✅ Every view is tied to a verified email, with time, IP and device recorded.
- ✅ Links can be disabled, expired, password protected, restricted to email domains, and gated behind an NDA.
- ❌ Anyone who can see a page can photograph or screenshot it. A watermark deters this and lets you trace a leak; it cannot prevent it.
- ❌ If you enable PDF download, the recipient has a (watermarked) PDF.
- ❌ Email verification proves control of a mailbox, not identity.

## Hardening checklist for operators

- Serve over HTTPS; set `SITE_URL=https://...` (cookies become `Secure`) and `HSTS=true`.
- Set `TRUST_PROXY=true` **only** behind a proxy you control, otherwise visitors can spoof their IP in logs and rate limits.
- Keep `SESSION_SECRET` secret and long; rotating it signs everyone out.
- Use a dedicated mailbox or provider for sending and set SPF/DKIM/DMARC.
- Back up the database and the file storage; the signed NDA PDFs are evidence.
- Restrict who can reach the server (firewall) and keep Docker images and Node.js up to date.
- Tell recipients what you record (name, email, time, IP, device, time per page). The reader shows a notice; adjust it if your jurisdiction requires more.

## Design notes

Signed HttpOnly cookies, SameSite=Lax and an Origin check on state-changing requests; one-time codes stored hashed with expiry and attempt limits;
rate limits on codes, passwords and downloads; additive, checksummed migrations; no third-party scripts, fonts or analytics
(a strict Content-Security-Policy is set). See [docs/architecture.md](docs/architecture.md).
