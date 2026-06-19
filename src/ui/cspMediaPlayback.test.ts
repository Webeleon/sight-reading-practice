// Guards the recording-playback regression: the renderer plays back a take via
// <audio src={URL.createObjectURL(blob)}> (a blob: URL — see DetectionReview's
// RecordingPlayer). The renderer CSP must therefore allow blob: as a media source,
// otherwise Chromium/Electron refuses to load it and the recording is silently
// "not available". media-src falls back to default-src when absent, and 'self'
// does NOT cover blob:, so blob: must be granted explicitly.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** Pull the Content-Security-Policy meta `content="..."` out of index.html. */
function readCsp(): string {
  const html = readFileSync(join(here, 'index.html'), 'utf8');
  // The content value itself contains single quotes ('self'), so match the
  // attribute's own quote char (group 1) and stop only at that same char.
  const match = html.match(
    /http-equiv=["']Content-Security-Policy["']\s+content=(["'])([\s\S]*?)\1/i,
  );
  if (!match) throw new Error('no Content-Security-Policy meta found in index.html');
  return match[2];
}

/** Parse "a 'self'; b x y" into { a: ["'self'"], b: ["x","y"] }. */
function parseDirectives(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of csp.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out[name.toLowerCase()] = sources;
  }
  return out;
}

describe('renderer CSP — recording playback', () => {
  it('allows blob: media so the take can be played back', () => {
    const directives = parseDirectives(readCsp());
    // media-src governs <audio>/<video>; it falls back to default-src when absent.
    const mediaSrc = directives['media-src'] ?? directives['default-src'] ?? [];
    expect(mediaSrc).toContain('blob:');
  });
});
