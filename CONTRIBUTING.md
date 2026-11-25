# Contributing to SendFolio

Thanks for helping! Bug reports, ideas, translations and pull requests are all welcome.

## Set up

```bash
git clone https://github.com/MurrayCmy/sendfolio.git && cd sendfolio
npm install
npm run init -- --admin-email you@example.com --yes
npm run dev          # API on :8787, hot-reloading UI on :5173 (uses embedded PGlite and ./data)
npm run demo         # optional sample data (empty database only)
```
Without SMTP, emails (including your login code) are printed in the terminal.

## Before you open a pull request

```bash
npm run typecheck && npm run i18n:check && npm run build
node dist-server/index.mjs > server.log 2>&1 &      # on an empty ./data
npm test -- --log server.log                          # end-to-end smoke test
```

## Guidelines

- **Small, focused changes** with a clear description. For big features open an issue first.
- **UI text**: write English in `t("...")` and add the Chinese to `src/locales/zh.ts`. `npm run i18n:check` must pass.
- **Database changes**: add a new migration file `netlify/database/migrations/<yyyymmddhhmmss>_<name>.sql`. Never edit an existing one; keep it additive (a deployed database must never lose data).
- **No hard-coded names, domains or emails** of any company; use `APP_NAME`/`COMPANY_NAME` and `example.com` addresses in examples and tests.
- **Accessibility**: labels for inputs and icon buttons, keyboard access, contrast 4.5:1, respect reduced motion.
- **Privacy**: do not add third-party requests, trackers or fonts from CDNs.
- Keep dependencies few; the project aims to stay easy to read and to deploy.

## Sign your commits (DCO)

By contributing you certify the [Developer Certificate of Origin](https://developercertificate.org/): add `Signed-off-by: Your Name <you@example.com>`
to each commit (`git commit -s`). Contributions are licensed under Apache-2.0, like the project.

## Translations

Copy `src/locales/zh.ts`, translate the values and follow [docs/customization.md](docs/customization.md#languages). Native-speaker review of NDA and email wording is especially valuable.
