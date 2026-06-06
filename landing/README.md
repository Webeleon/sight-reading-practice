# Sight Reading — landing page

A deployable Next.js (App Router, TypeScript) landing page that reproduces the
**"Signal Tape"** mockup from `../design/landing.html`. It tells the story
(problem → how it works → proof → download) and runs the market-test mechanic:
an **email-gated download** that POSTs to a small pseudo-backend, records the
email, and returns a GitHub Releases download link.

## Stack

- **Next.js 16** (App Router) · **React 19** · **TypeScript**
- **Plain CSS** — the design system is ported from `../design/signal-tape.css`
  into `app/globals.css`; each section's layout is a co-located **CSS Module**.
- **`next/font/google`** for Archivo (400/500/600/800/900) and DM Mono
  (400/500), wired to the `--disp` / `--mono` CSS variables so the ported CSS
  works unchanged.

## Project layout

```
landing/
├─ app/
│  ├─ layout.tsx            # fonts (next/font), metadata, <html lang="en">
│  ├─ page.tsx              # composes the sections
│  ├─ globals.css           # ported design system + shared section primitives
│  └─ api/subscribe/route.ts# POST handler — the pseudo-backend
├─ components/              # Nav, Hero, ProofStrip, Problem, HowItWorks,
│  │                        #   Proof, Download, Faq, Footer, EmailGate
│  └─ *.module.css          # co-located, section-scoped styles
├─ lib/subscribers.ts       # pluggable email capture (webhook / Resend / log)
└─ ...config
```

The `EmailGate` is a **client component** (`'use client'`) used twice — a light
variant in the hero and a dark variant in the download band. It validates the
email client-side, POSTs to `/api/subscribe`, and renders the exact
enter → "link sent" success state from the mockup (the entered email, a
Download button using the returned URL, and a GitHub Releases fallback link).

## Develop

```bash
npm install      # (a later phase runs this — deps are pinned in package.json)
npm run dev      # http://localhost:3000
```

Build and run the production server locally:

```bash
npm run build
npm run start
```

## Email capture (the pseudo-backend)

`POST /api/subscribe` with `{ "email": "you@guitar.com", "source": "light" }`.

- On success it **always** returns `{ ok: true, downloadUrl }`, where
  `downloadUrl = process.env.RELEASES_URL` or a GitHub Releases placeholder.
- On an invalid email it returns `400 { ok: false, error }`.
- It never throws an unhandled error — failures surface as JSON, and the user
  still receives a download link.

`lib/subscribers.ts` picks a storage strategy at runtime, in priority order:

1. **`SUBSCRIBE_WEBHOOK_URL`** — POSTs `{ email, source, ts }` to your webhook
   (Zapier / Make / your own endpoint).
2. **`RESEND_API_KEY` + `RESEND_AUDIENCE_ID`** — adds the contact to a
   [Resend](https://resend.com) audience.
3. **Fallback** — `console.log`, and **in development only**, appends to
   `.emails.local.json` (git-ignored).

### Environment variables

Copy `.env.example` to `.env.local` and fill in what you need:

| Variable                   | Required | Purpose                                                |
| -------------------------- | -------- | ------------------------------------------------------ |
| `NEXT_PUBLIC_RELEASES_URL` | no\*     | Public GitHub Releases / download URL. Read by both the client link and the subscribe API (single source of truth, `lib/releases.ts`). Defaults to a placeholder — **set this** before launch. |
| `RELEASES_URL`             | no       | Server-only override for the emailed/returned download link; takes precedence over `NEXT_PUBLIC_RELEASES_URL` for the API response. |
| `SUBSCRIBE_WEBHOOK_URL`    | no       | Forward captured emails to a webhook.                  |
| `RESEND_API_KEY`           | no       | Resend API key (used with the audience id).            |
| `RESEND_AUDIENCE_ID`       | no       | Resend audience to add contacts to.                    |

\* Not required to run, but you'll want a real release URL in production. The
fallback slug in `lib/releases.ts` tracks the project directory name
(`webeleon/sight-reading-guitar-practice`); confirm/update it when the public
repo exists.

## Deploy on Vercel

1. Push the repo. In Vercel, import it and set **Root Directory = `landing`**.
   The framework preset (Next.js), build command (`next build`), and output are
   auto-detected.
2. Add the environment variables above in **Project → Settings → Environment
   Variables** (at minimum `RELEASES_URL`).
3. Deploy.

### Production wiring (read before launch)

> **Vercel's serverless filesystem is read-only at runtime**, so the
> `.emails.local.json` fallback is **development-only** and will not persist
> anything in production. Pick a real sink:
>
> - **Resend** (simplest for an email list): set `RESEND_API_KEY` +
>   `RESEND_AUDIENCE_ID`. `lib/subscribers.ts` already calls the audiences API;
>   to actually *email* the download link, add a `resend.emails.send(...)` call
>   in the Resend branch.
> - **Vercel KV / Postgres** (own your data): add `@vercel/kv` or
>   `@vercel/postgres`, then in `recordSubscriber()` replace the fallback branch
>   with a `kv.sadd('subscribers', email)` (dedupes) or a `INSERT ... ON
>   CONFLICT DO NOTHING` against a `subscribers(email, source, ts)` table.
> - **Webhook**: set `SUBSCRIBE_WEBHOOK_URL` to hand off to any external system
>   without adding a dependency.

The capture function is intentionally small and pluggable — swap the fallback
branch for your chosen backend and the rest of the app is untouched.
