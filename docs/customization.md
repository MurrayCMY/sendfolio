# Customization

## Branding, logo, colours & reader button (no code needed)

Open **Admin → Settings → Branding** to set your workspace name, upload a custom logo (PNG/SVG/WebP under 100 KB), pick a brand colour, and add an optional action button (e.g. "Book a call" → Calendly / Cal.com) to the investor reader header.

For environment defaults or deeper styling:
- Set `APP_NAME`, `COMPANY_NAME`, and `BRAND_COLOR` in `.env`.
- Browser favicon: `public/favicon.svg`.
- Full CSS tokens: `src/styles.css` (`:root`) and `src/admin/admin.css` (`.admin`).

## The NDA

The first time an NDA is needed, a **sample template** is installed (`server/lib/nda-default.ts`). It is a generic one-way agreement and
**not legal advice**. Replace it with your own text in **Admin → Settings → NDA → New NDA version**.

- Provide an English and a Chinese text (if you only need one language, paste the same text in both).
- Paragraphs are separated by blank lines; `**bold**` is supported.
- Old versions are kept. Every signature stores a hash of the exact text that was accepted.
- To turn the NDA off for a link, untick "Require NDA acceptance" on that link.

## Languages

English and Simplified Chinese are built in. To add a language (say Spanish, `es`):

1. Copy `src/locales/zh.ts` to `src/locales/es.ts` and translate the values (keep `{0}` placeholders).
2. In `src/i18n.ts` add it to `Lang`, `LANGS` and `DICTS`.
3. In `src/visitor/i18n.ts` add an `es` block to `dict` (the visitor screens).
4. In `server/lib/config.ts` add it to `Locale`/`pickLocale`, and in `server/lib/emails.ts` add the wording for emails.
5. `npm run i18n:check` lists anything missing.

## Time zone and date format

Set `TIMEZONE` (IANA name). Dates appear as `YYYY-MM-DD HH:mm` in that zone.

## Sending email from your own domain

See the Email section of [deploy-docker.md](deploy-docker.md). Use Admin → NDA & settings → Email & domain to check MX, SPF, DKIM and DMARC.
