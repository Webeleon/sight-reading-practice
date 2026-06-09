/**
 * Pluggable subscriber capture.
 *
 * Strategy is chosen at runtime from environment variables, in priority order:
 *
 *   1. SUBSCRIBE_WEBHOOK_URL   → POST { email, source, ts } to the webhook.
 *   2. RESEND_API_KEY + RESEND_AUDIENCE_ID → add the contact to a Resend audience.
 *   3. (fallback) console.log, and in development only, append to a local JSON
 *      file (.emails.local.json). Vercel's filesystem is read-only at runtime,
 *      so the file path NEVER runs in production — see README "Production wiring".
 *
 * None of these throw to the caller: failures are logged and reported back so
 * the API route can always return clean JSON.
 */

import { getReleasesUrl } from "./releases";

/**
 * The download URL handed back to the client (and emailed, in production).
 *
 * Honours the server-only `RELEASES_URL` override first (lets you point the
 * emailed link at a specific build), then falls back to the shared releases URL
 * (`NEXT_PUBLIC_RELEASES_URL` / the placeholder constant) so the server and the
 * client's "GitHub Releases" link share one source of truth.
 */
export function getDownloadUrl(): string {
  return process.env.RELEASES_URL || getReleasesUrl();
}

/** RFC-pragmatic email check — mirrors the client-side validation. */
export function isValidEmail(email: unknown): email is string {
  return (
    typeof email === "string" &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  );
}

export type RecordResult = {
  stored: boolean;
  via: "webhook" | "resend" | "local-file" | "console";
};

export type SubscriberInput = {
  email: string;
  /** Which gate the submission came from ("light" hero / "dark" download). */
  source?: string;
};

export async function recordSubscriber(
  input: SubscriberInput,
): Promise<RecordResult> {
  const email = input.email.trim().toLowerCase();
  const payload = {
    email,
    source: input.source ?? "landing",
    ts: new Date().toISOString(),
  };

  // 1) External webhook ------------------------------------------------------
  if (process.env.SUBSCRIBE_WEBHOOK_URL) {
    try {
      const res = await fetch(process.env.SUBSCRIBE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.error(
          `[subscribers] webhook responded ${res.status} ${res.statusText}`,
        );
        return { stored: false, via: "webhook" };
      }
      return { stored: true, via: "webhook" };
    } catch (err) {
      console.error("[subscribers] webhook request failed", err);
      return { stored: false, via: "webhook" };
    }
  }

  // 2) Resend audience -------------------------------------------------------
  if (process.env.RESEND_API_KEY && process.env.RESEND_AUDIENCE_ID) {
    try {
      const res = await fetch(
        `https://api.resend.com/audiences/${process.env.RESEND_AUDIENCE_ID}/contacts`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, unsubscribed: false }),
        },
      );
      if (!res.ok) {
        console.error(
          `[subscribers] Resend responded ${res.status} ${res.statusText}`,
        );
        return { stored: false, via: "resend" };
      }
      return { stored: true, via: "resend" };
    } catch (err) {
      console.error("[subscribers] Resend request failed", err);
      return { stored: false, via: "resend" };
    }
  }

  // 3) Fallback: console (always) + dev-only local file ----------------------
  console.log("[subscribers] captured email:", JSON.stringify(payload));

  if (process.env.NODE_ENV !== "production") {
    try {
      // Dynamic imports keep node:fs/node:path out of any edge bundle.
      const { promises: fs } = await import("node:fs");
      const path = await import("node:path");
      const file = path.join(process.cwd(), ".emails.local.json");

      let list: unknown[] = [];
      try {
        const raw = await fs.readFile(file, "utf8");
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) list = parsed;
      } catch {
        // file missing or unparseable — start fresh
      }
      list.push(payload);
      await fs.writeFile(file, JSON.stringify(list, null, 2), "utf8");
      return { stored: true, via: "local-file" };
    } catch (err) {
      console.error("[subscribers] local-file append failed", err);
      return { stored: true, via: "console" };
    }
  }

  return { stored: true, via: "console" };
}

// --- Transactional email (Resend) -------------------------------------------
//
// On each signup we send TWO emails via Resend's REST API (raw fetch, to match
// the style above — no SDK dependency):
//
//   1. sendLeadNotification → tells the operator a new lead came in.
//   2. sendDownloadEmail    → welcomes the visitor and hands over the download
//      link (makes the "Check your inbox" UI copy true).
//
// Both require RESEND_API_KEY + RESEND_FROM. Like recordSubscriber, they never
// throw to the caller — failures are logged and reported as { sent: false } so
// the API route can always return a clean download link.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Minimal HTML-escape for interpolating user/config values into email bodies. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from) {
    console.warn(
      "[subscribers] RESEND_API_KEY / RESEND_FROM not set — skipping email send",
    );
    return { sent: false };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        ...(opts.text ? { text: opts.text } : {}),
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      }),
    });
    if (!res.ok) {
      console.error(
        `[subscribers] Resend email responded ${res.status} ${res.statusText}`,
      );
      return { sent: false };
    }
    return { sent: true };
  } catch (err) {
    console.error("[subscribers] Resend email request failed", err);
    return { sent: false };
  }
}

/**
 * Build the visitor's welcome + download email (Signal Tape styling).
 *
 * Pure: returns { subject, html, text } so the body can be previewed and tested
 * without sending. `sendDownloadEmail` wraps this with `sendEmail`.
 */
export function buildDownloadEmail(downloadUrl: string): {
  subject: string;
  html: string;
  text: string;
} {
  const url = escapeHtml(downloadUrl);
  // HTML uses entities (not raw multibyte chars) so the email renders correctly
  // regardless of the client's charset handling; the plaintext part stays ASCII.
  const preheader =
    "Your Sight Reading demo is ready &mdash; download and start a drill in under a minute.";

  // One numbered row of the "Getting started" list. A table keeps the number
  // and copy aligned across the email clients that ignore list styling.
  const step = (n: number, body: string) => `
        <tr>
          <td valign="top" style="padding:0 12px 10px 0;color:#1D3DF0;font-weight:700;font-size:14px;line-height:1.5">${n}</td>
          <td valign="top" style="padding:0 0 10px;font-size:14px;line-height:1.5;color:#4A463F">${body}</td>
        </tr>`;

  const html = `
  <div style="font-family:-apple-system,system-ui,Segoe UI,sans-serif;background:#ECE7DA;padding:32px 16px;color:#141210">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#ECE7DA;font-size:1px;line-height:1px">${preheader}</div>
    <div style="max-width:480px;margin:0 auto;background:#F3EFE4;border:1px solid #CFC8B6;border-radius:4px;padding:32px">
      <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8A8478">Sight Reading</p>
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.25">You're in &mdash; here's your demo</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#4A463F">
        Thanks for signing up. Sight Reading turns notes on the staff into instant
        recognition on the fretboard &mdash; read the note, play it, build speed. Grab the
        build below and you can start a drill in under a minute.
      </p>
      <p style="margin:0 0 12px">
        <a href="${url}" style="display:inline-block;background:#1D3DF0;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:4px">Download the demo &darr;</a>
      </p>
      <p style="margin:0 0 28px;font-size:13px;line-height:1.5;color:#8A8478">
        macOS &amp; Windows &middot; ~5&nbsp;MB &middot; or open it in your browser:
        <a href="${url}" style="color:#142BB0">${url}</a>
      </p>
      <div style="border-top:1px solid #CFC8B6;margin:0 0 20px"></div>
      <p style="margin:0 0 12px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8A8478">Getting started</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px">
        ${step(1, "Install and open it.")}
        ${step(2, "Pick a string set and position, then press start.")}
        ${step(3, "Read the note, play it on the fretboard, and keep the streak going.")}
      </table>
      <p style="margin:0;font-size:15px;line-height:1.5;color:#4A463F">
        I build this solo and read every reply &mdash; tell me what's working and what isn't.<br />
        <strong>&mdash; Julien</strong>
      </p>
    </div>
    <p style="max-width:480px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#8A8478;text-align:center">
      You're getting this because you requested the Sight Reading demo.
    </p>
  </div>`;

  const text = [
    "SIGHT READING",
    "",
    "You're in - here's your demo.",
    "",
    "Thanks for signing up. Sight Reading turns notes on the staff into instant",
    "recognition on the fretboard - read the note, play it, build speed. Grab the",
    "build below and you can start a drill in under a minute.",
    "",
    "Download the demo (macOS & Windows, ~5 MB):",
    downloadUrl,
    "",
    "Getting started:",
    "  1. Install and open it.",
    "  2. Pick a string set and position, then press start.",
    "  3. Read the note, play it on the fretboard, and keep the streak going.",
    "",
    "I build this solo and read every reply - tell me what's working and what isn't.",
    "- Julien",
    "",
    "You're getting this because you requested the Sight Reading demo.",
  ].join("\n");

  return {
    subject: "Welcome to Sight Reading — your demo download",
    html,
    text,
  };
}

/** Email the visitor their welcome + demo download (Signal Tape styling). */
export async function sendDownloadEmail(
  userEmail: string,
  downloadUrl: string,
): Promise<{ sent: boolean }> {
  const { subject, html, text } = buildDownloadEmail(downloadUrl);
  return sendEmail({ to: userEmail, subject, html, text });
}

/**
 * Notify the operator that a new lead came in. Goes to SUBSCRIBE_NOTIFY_TO
 * (default julien@webeleon.dev), with reply-to set to the lead so you can reply
 * straight from your inbox.
 */
export async function sendLeadNotification(lead: {
  email: string;
  source?: string;
  downloadUrl: string;
}): Promise<{ sent: boolean }> {
  const to = process.env.SUBSCRIBE_NOTIFY_TO || "julien@webeleon.dev";
  const email = escapeHtml(lead.email);
  const source = escapeHtml(lead.source ?? "landing");
  const ts = new Date().toISOString();
  const html = `
  <div style="font-family:-apple-system,system-ui,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#141210">
    <h2 style="margin:0 0 12px;font-size:18px">New demo signup</h2>
    <table style="border-collapse:collapse">
      <tr><td style="padding:2px 12px 2px 0;color:#8A8478">Email</td><td><a href="mailto:${email}">${email}</a></td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#8A8478">Source</td><td>${source}</td></tr>
      <tr><td style="padding:2px 12px 2px 0;color:#8A8478">Time</td><td>${ts}</td></tr>
    </table>
  </div>`;
  return sendEmail({
    to,
    replyTo: lead.email,
    subject: `New demo signup: ${lead.email}`,
    html,
  });
}
