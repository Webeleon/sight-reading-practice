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

`POST /api/subscribe` with
`{ "email": "you@guitar.com", "source": "light", "company": "" }`.

- On success it **always** returns `{ ok: true, downloadUrl }`, where
  `downloadUrl = process.env.RELEASES_URL` or a GitHub Releases placeholder.
- On an invalid email it returns `400 { ok: false, error }`.
- It never throws an unhandled error — failures surface as JSON, and the user
  still receives a download link.
- `company` is a **honeypot**: real users leave it empty (it's an off-screen,
  non-focusable field in `EmailGate`). A non-empty value is treated as a bot —
  the API returns the normal success JSON but records/sends nothing. This guards
  the endpoint from being abused as a spam relay, since it emails arbitrary
  submitted addresses.

On each valid signup the API sends **two emails via [Resend](https://resend.com)**
(`sendLeadNotification` + `sendDownloadEmail` in `lib/subscribers.ts`, both
require `RESEND_API_KEY` + `RESEND_FROM`):

1. a **lead notification** to `SUBSCRIBE_NOTIFY_TO` (default `julien@webeleon.dev`,
   reply-to = the lead) so you receive every signup, and
2. the **download link** to the visitor — which is what the "Check your inbox"
   success state promises.

It also calls `recordSubscriber()`, which keeps a runtime storage strategy in
priority order (useful as a secondary record or instead of the notification
email):

1. **`SUBSCRIBE_WEBHOOK_URL`** — POSTs `{ email, source, ts }` to your webhook
   (Zapier / Make / your own endpoint).
2. **`RESEND_API_KEY` + `RESEND_AUDIENCE_ID`** — adds the contact to a Resend
   audience (an exportable list for a launch blast).
3. **Fallback** — `console.log`, and **in development only**, appends to
   `.emails.local.json` (git-ignored).

### Environment variables

Copy `.env.example` to `.env.local` and fill in what you need:

| Variable                   | Required | Purpose                                                |
| -------------------------- | -------- | ------------------------------------------------------ |
| `NEXT_PUBLIC_RELEASES_URL` | no\*     | Public GitHub Releases / download URL. Read by both the client link and the subscribe API (single source of truth, `lib/releases.ts`). Defaults to a placeholder — **set this** before launch. |
| `RELEASES_URL`             | no       | Server-only override for the emailed/returned download link; takes precedence over `NEXT_PUBLIC_RELEASES_URL` for the API response. |
| `RESEND_API_KEY`           | no\*\*   | Resend API key. Needed to send any email (lead notification + visitor download link). |
| `RESEND_FROM`              | no\*\*   | Verified sender, e.g. `"Sight Reading <hello@webeleon.dev>"`. Needed to send. Use `onboarding@resend.dev` for local testing. |
| `SUBSCRIBE_NOTIFY_TO`      | no       | Where lead notifications go. Defaults to `julien@webeleon.dev`. |
| `SUBSCRIBE_WEBHOOK_URL`    | no       | Forward captured emails to a webhook (alternative sink in `recordSubscriber`). |
| `RESEND_AUDIENCE_ID`       | no       | If set with `RESEND_API_KEY`, also adds contacts to a Resend audience. |

\* Not required to run, but you'll want a real release URL in production. The
fallback slug in `lib/releases.ts` tracks the project directory name
(`webeleon/sight-reading-guitar-practice`); confirm/update it when the public
repo exists.

\*\* Not required to run, but **without `RESEND_API_KEY` + `RESEND_FROM` no
emails are sent** — neither you nor the visitor receives anything, and the
"Check your inbox" copy would be untrue. Set both before launch.

## Deploy on Vercel

1. Push the repo. In Vercel, import it and set **Root Directory = `landing`**.
   The framework preset (Next.js), build command (`next build`), and output are
   auto-detected.
2. Add the environment variables above in **Project → Settings → Environment
   Variables** (at minimum `RELEASES_URL`).
3. Deploy.

### Production wiring (read before launch)

> **The default path is email** (`lib/subscribers.ts`): set `RESEND_API_KEY` +
> `RESEND_FROM` (and optionally `SUBSCRIBE_NOTIFY_TO`) and every signup emails
> you the lead **and** emails the visitor their download link. Verify a sending
> domain in Resend for good deliverability (`onboarding@resend.dev` works for
> testing but only sends to your own Resend account email).
>
> **Vercel's serverless filesystem is read-only at runtime**, so the
> `.emails.local.json` fallback in `recordSubscriber()` is **development-only**
> and persists nothing in production. If you also want a stored list, pick a sink:
>
> - **Resend audience** (exportable list for a launch blast): also set
>   `RESEND_AUDIENCE_ID` — `recordSubscriber()` adds the contact (dedupes).
> - **Vercel KV / Postgres** (own your data): add `@vercel/kv` or
>   `@vercel/postgres`, then in `recordSubscriber()` replace the fallback branch
>   with a `kv.sadd('subscribers', email)` (dedupes) or a `INSERT ... ON
>   CONFLICT DO NOTHING` against a `subscribers(email, source, ts)` table.
> - **Webhook**: set `SUBSCRIBE_WEBHOOK_URL` to hand off to any external system
>   without adding a dependency.

The email senders and capture function are intentionally small — raw `fetch` to
Resend, no SDK. Swap the storage branch for your chosen backend and the rest of
the app is untouched.
