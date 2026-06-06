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
