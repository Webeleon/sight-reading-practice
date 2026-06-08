"use client";

import { useId, useState } from "react";
import styles from "./EmailGate.module.css";
import { getReleasesUrl } from "@/lib/releases";

/**
 * GitHub Releases fallback shown as the no-friction download path. Sourced from
 * the shared `lib/releases` module (honouring NEXT_PUBLIC_RELEASES_URL) so it
 * can't drift from the URL the subscribe API returns.
 */
const RELEASES_FALLBACK_URL = getReleasesUrl();

/**
 * Lightweight client-side email check. The server re-validates; this only
 * gates the optimistic UI and surfaces an inline error, matching the mockup's
 * "must contain @" behaviour but a touch stricter.
 */
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

type EmailGateProps = {
  variant?: "light" | "dark";
};

export function EmailGate({ variant = "light" }: EmailGateProps) {
  const isDark = variant === "dark";

  const [email, setEmail] = useState("");
  // Honeypot — must stay empty for real users; bots that fill it are dropped
  // server-side. Never rendered visibly (see the hidden input below).
  const [company, setCompany] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sentEmail, setSentEmail] = useState("");
  const [downloadUrl, setDownloadUrl] = useState(RELEASES_FALLBACK_URL);

  const inputId = useId();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = email.trim();

    if (!isValidEmail(value)) {
      setError("That doesn't look like a valid email — check it and try again.");
      return;
    }
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value, source: variant, company }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; downloadUrl?: string; error?: string }
        | null;

      if (!res.ok || !data?.ok) {
        setError(
          data?.error ?? "Something went wrong sending the link. Try again.",
        );
        return;
      }

      setSentEmail(value);
      if (data.downloadUrl) setDownloadUrl(data.downloadUrl);
      setSent(true);
    } catch {
      setError(
        "Couldn't reach the server. Check your connection and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const rootClass = `${styles.gate} ${isDark ? styles.dark : styles.light}`;

  if (sent) {
    return (
      <div className={rootClass} data-gate>
        {isDark ? (
          <DarkSuccess email={sentEmail} downloadUrl={downloadUrl} />
        ) : (
          <LightSuccess email={sentEmail} downloadUrl={downloadUrl} />
        )}
        {isDark && <Platforms />}
      </div>
    );
  }

  return (
    <div className={rootClass} data-gate>
      <div className={styles.gateLbl}>
        {isDark ? "Email me the demo" : "Get the demo"}
      </div>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {/* Honeypot: off-screen, not focusable, hidden from AT. Leave empty. */}
        <input
          type="text"
          name="company"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          style={{
            position: "absolute",
            left: "-9999px",
            width: 1,
            height: 1,
            opacity: 0,
          }}
        />
        <input
          id={inputId}
          type="email"
          name="email"
          placeholder="you@guitar.com"
          autoComplete="email"
          required
          aria-label="Email address"
          aria-invalid={error ? true : undefined}
          className={error ? styles.inputError : undefined}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError(null);
          }}
        />
        <button type="submit" disabled={submitting}>
          {isDark ? "Send the link" : "Email me the link"}
        </button>
      </form>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {isDark ? (
        <Platforms />
      ) : (
        <p className={styles.fine}>
          macOS · Windows · ~5&nbsp;MB · early prototype · we&apos;ll only email
          about this. <a href="#get">Why email?</a>
        </p>
      )}
    </div>
  );
}

function LightSuccess({
  email,
  downloadUrl,
}: {
  email: string;
  downloadUrl: string;
}) {
  return (
    <div className={styles.done} role="status" aria-live="polite">
      <div className={styles.ok}>✓ Link on its way</div>
      <div className={styles.msg}>
        Sent a download link to <b>{email}</b>. Or grab it now:
      </div>
      <div className={styles.dl}>
        <a className="btn btn-ink btn-sm" href={downloadUrl}>
          ↓ Download for macOS
        </a>
        <a
          className="releases"
          href={RELEASES_FALLBACK_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          or all builds on GitHub Releases ↗
        </a>
      </div>
    </div>
  );
}

function DarkSuccess({
  email,
  downloadUrl,
}: {
  email: string;
  downloadUrl: string;
}) {
  return (
    <div className={styles.done} role="status" aria-live="polite">
      <div className={styles.ok}>✓ Check your inbox</div>
      <div className={styles.msg}>
        Download link sent to <b>{email}</b>.
      </div>
      <div className={styles.dl}>
        <a className="btn btn-blue btn-sm" href={downloadUrl}>
          ↓ Download now
        </a>
        <a
          className="releases"
          href={RELEASES_FALLBACK_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#9fb0ff" }}
        >
          GitHub Releases ↗
        </a>
      </div>
    </div>
  );
}

function Platforms() {
  return (
    <div className={styles.platforms}>
      <span>◆ macOS (Apple&nbsp;Silicon + Intel)</span>
      <span>◆ Windows</span>
      <span>◆ ~5&nbsp;MB</span>
    </div>
  );
}
