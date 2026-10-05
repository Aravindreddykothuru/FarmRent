# FarmRent — web app

The Next.js App Router front end, and the unified server (`server.js`) that serves the pages, the REST
API and the websockets from one process on one port.

**This package is not run on its own.** It needs Postgres, the PostgREST gateway and Redis, which the
repository root brings up. Start there:

- **[Root README](../README.md)** — architecture, how to run the stack locally, tests, deployment
- **Live site — <https://farmrentcom.in>**
- **Render host — <https://farmrent-l9gk.onrender.com>**

```bash
# from the repository root, not from here
npm run setup:env && npm run stack:up && npm run install:all
npm run migrate && npm run seed
npm run dev
```

## What lives here

| Path | What it is |
|---|---|
| `app/` | App Router pages |
| `components/` | shared UI; `ui/` is shadcn/ui |
| `context/` | auth and language providers |
| `messages/`, `i18n/config.ts` | UI strings, one file per language, and the list of locales |
| `lib/contact.ts` | support phone, email and location — the one place they are written down |
| `public/manifest.webmanifest`, `public/icons/` | PWA manifest and icons, so Android can install the app |
| `server.js` | the unified server, used in both development and production |
| `proxy.ts` | sign-in redirects for protected pages |
| `scripts/ui-smoke.mjs` | browser smoke test; `scripts/check-links.cjs` finds dead internal links |

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | development server (prefer `npm run dev` at the root, which checks the stack is up) |
| `npm run build` / `npm start` | production build and server |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | type check |
| `npm run check:links` | every hard-coded internal link points at a page that exists |
