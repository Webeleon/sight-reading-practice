// HeadphoneTip — one-time, non-blocking guidance (brief sections 12 & 18).
//
// Disposable UI layer. The brief's section-18 default is to NOT attempt output-
// routing detection and instead always show a soft, dismissible tip that
// headphones improve detection (playing through speakers lets the metronome/
// playback bleed into the mic and pollute pitch detection).
//
// CONTROLLED: visibility + dismissal are owned by App (hydrated from the
// `headphoneTipDismissed` config flag and persisted there), so the Settings
// "re-show headphone tip" reset can bring it back immediately within the session
// rather than only on the next launch. This component is now pure presentation.
//
// PRESENTATION: matches the Signal Tape advisory tip from design/app.html screen
// 01 (the dashed .onb .tip row with a headphone glyph). Uses the existing
// .headphone-tip styles.css class (dashed advisory); the glyph + layout are local.

import React from 'react';

export interface HeadphoneTipProps {
  /** Whether the tip is currently shown (App owns this, hydrated from config). */
  show: boolean;
  /** Dismiss the tip (App hides it + persists headphoneTipDismissed). */
  onDismiss: () => void;
}

export function HeadphoneTip({
  show,
  onDismiss,
}: HeadphoneTipProps): React.JSX.Element | null {
  if (!show) return null;

  return (
    <div className="headphone-tip" role="note">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
        <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>
          🎧
        </span>
        <span>
          Use headphones so the metronome doesn&rsquo;t leak into the mic.
          Playing through speakers lets background sound bleed in and hurts pitch
          detection — it keeps your scores honest.
        </span>
      </span>
      <button type="button" className="btn btn-small" onClick={onDismiss}>
        Got it
      </button>
    </div>
  );
}
