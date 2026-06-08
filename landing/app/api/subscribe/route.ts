import { NextResponse } from "next/server";
import {
  getDownloadUrl,
  isValidEmail,
  recordSubscriber,
  sendDownloadEmail,
  sendLeadNotification,
} from "@/lib/subscribers";

// Node.js runtime: the dev-only fallback writes to the filesystem, which the
// edge runtime can't do. (In production the file path is never taken.)
export const runtime = "nodejs";
// This endpoint must never be statically cached.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const downloadUrl = getDownloadUrl();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const email = (body as { email?: unknown } | null)?.email;
  const source = (body as { source?: unknown } | null)?.source;
  // Honeypot: a hidden field real users never fill. If it has any value, treat
  // the request as a bot and silently succeed — no recording, no emails sent.
  // Stops the endpoint being abused as a spam relay (it emails arbitrary
  // submitted addresses).
  const honeypot = (body as { company?: unknown } | null)?.company;

  if (typeof honeypot === "string" && honeypot.trim() !== "") {
    return NextResponse.json({ ok: true, downloadUrl });
  }

  if (!isValidEmail(email)) {
    return NextResponse.json(
      { ok: false, error: "Please enter a valid email address." },
      { status: 400 },
    );
  }

  try {
    const normalisedSource = typeof source === "string" ? source : undefined;
    await recordSubscriber({ email, source: normalisedSource });
    // Fire both emails; neither throws, and a failure must not break the
    // response — the user still gets their download link below.
    await Promise.allSettled([
      sendLeadNotification({ email, source: normalisedSource, downloadUrl }),
      sendDownloadEmail(email, downloadUrl),
    ]);
  } catch (err) {
    // recordSubscriber/sends are defensive, but never let an unexpected throw
    // escape as a 500 — the user still gets their download link.
    console.error("[api/subscribe] unexpected error", err);
  }

  // ALWAYS hand back the download link, regardless of capture success.
  return NextResponse.json({ ok: true, downloadUrl });
}

// Reject non-POST verbs with clean JSON rather than the default HTML 405.
export async function GET() {
  return NextResponse.json(
    { ok: false, error: "Method not allowed. Use POST." },
    { status: 405 },
  );
}
