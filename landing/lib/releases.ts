/**
 * Single source of truth for the GitHub Releases / download URL.
 *
 * Both the server (subscribe API, via `getDownloadUrl()`) and the client
 * (`EmailGate`'s "GitHub Releases" link) read from here so the two can never
 * drift. The value resolves, in priority order:
 *
 *   1. NEXT_PUBLIC_RELEASES_URL — inlined at build time, readable on both
 *      server and client. Set this in production.
 *   2. RELEASES_FALLBACK_URL    — the constant below.
 *
 * NOTE on the slug: confirmed against the git remote — the canonical repo is
 * `Webeleon/sight-reading-practice`, which is where the release workflow
 * (.github/workflows/release.yml) publishes installers. Override with
 * NEXT_PUBLIC_RELEASES_URL if releases ever move; that is the only other place
 * the slug lives.
 */

/** The canonical GitHub Releases page used when no env override is set. */
export const RELEASES_FALLBACK_URL =
  "https://github.com/Webeleon/sight-reading-practice/releases/latest";

/**
 * The releases/download URL, honouring the NEXT_PUBLIC_RELEASES_URL override.
 *
 * `process.env.NEXT_PUBLIC_*` is statically replaced by Next at build time, so
 * this works unchanged in both client and server bundles.
 */
export function getReleasesUrl(): string {
  return process.env.NEXT_PUBLIC_RELEASES_URL || RELEASES_FALLBACK_URL;
}

/** The repository home (for the nav/footer "GitHub ↗" links) — same slug as the
 *  releases URL, so it tracks the single source of truth. Override with
 *  NEXT_PUBLIC_REPO_URL when the canonical slug is confirmed. */
export const REPO_FALLBACK_URL =
  "https://github.com/Webeleon/sight-reading-practice";

export function getRepoUrl(): string {
  return process.env.NEXT_PUBLIC_REPO_URL || REPO_FALLBACK_URL;
}
