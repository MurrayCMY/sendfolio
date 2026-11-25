# Customization

## Your name

Set `APP_NAME` (and `COMPANY_NAME` for the legal/display name in the NDA and emails). It appears in the sidebar, the reader header, emails,
page titles and the NDA PDF footer. No code changes needed.

## Logo and favicon

- The mark is `src/ui/Logo.tsx` (an inline SVG that follows the text colour). Replace its paths, or return an `<img>` instead.
- The browser icon is `public/favicon.svg`.

## Colours

The web UI colours are CSS variables at the top of two files:

- `src/styles.css` → `:root { --primary, --dark, --tint, --bg ... }` (reader and sign-in pages)
- `src/admin/admin.css` → `.admin { --a-primary, --a-ink, --a-tint ... }` (admin area)

Change the values, then `npm run build`. Keep text/background pairs at a contrast ratio of 4.5:1 or better.
Email accent colour: `BRAND_COLOR`.

## The NDA

The first time an NDA is needed, a **sample template** is installed (`server/lib/nda-default.ts`). It is a generic one-way agreement and
**not legal advice**. Replace it with your own text in **Admin → NDA & settings → NDA versions → Upload new version**.

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
