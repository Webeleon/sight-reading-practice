// HeadphoneTip — one-time, non-blocking guidance (brief sections 12 & 18).
//
// Disposable UI layer. The brief's section-18 default is to NOT attempt output-
// routing detection and instead always show a soft, dismissible tip that
// headphones improve detection (playing through speakers lets the metronome/
// playback bleed into the mic and pollute pitch detection). Dismissal is
// persisted so it only shows once.

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
      <span>
        Tip: use headphones. Playing through speakers lets the metronome and
        background sound bleed into the mic and hurts pitch detection.
      </span>
      <button className="btn btn-small" onClick={dismiss}>
        Got it
      </button>
    </div>
  );
}
