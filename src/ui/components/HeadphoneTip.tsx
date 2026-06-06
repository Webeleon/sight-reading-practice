// HeadphoneTip — one-time, non-blocking guidance (brief sections 12 & 18).
//
// Disposable UI layer. The brief's section-18 default is to NOT attempt output-
// routing detection and instead always show a soft, dismissible tip that
// headphones improve detection (playing through speakers lets the metronome/
// playback bleed into the mic and pollute pitch detection). Dismissal is
// persisted so it only shows once.
//
// PRESENTATION ONLY: matches the Signal Tape advisory tip from design/app.html
// screen 01 (the dashed .onb .tip row with a headphone glyph). Behaviour is
// unchanged — same show / dismiss / persistence. Uses the existing .headphone-tip
// styles.css class (dashed advisory); the glyph + layout are local markup.

import React, { useCallback, useEffect, useState } from 'react';
import { getAppConfig, setAppConfig } from '../appConfig.js';

export function HeadphoneTip(): React.JSX.Element | null {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cfg = await getAppConfig();
      if (!cancelled) setShow(!cfg.headphoneTipDismissed);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback((): void => {
    setShow(false);
    void setAppConfig({ headphoneTipDismissed: true });
    console.log('[UI] headphone tip dismissed (persisted)');
  }, []);

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
      <button type="button" className="btn btn-small" onClick={dismiss}>
        Got it
      </button>
    </div>
  );
}
