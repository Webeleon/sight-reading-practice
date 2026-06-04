// OsmdView — renders a Line as notation via OpenSheetMusicDisplay (OSMD).
//
// Disposable UI layer (brief sections 2 & 5): DOM/React allowed here.
//
// Responsibility: given a Line, serialize it to MusicXML (the pure serializer) and
// render it into a container div with OSMD. Re-render on a new Line. Expose an
// imperative handle (CursorHandle) so the read-along loop can drive OSMD's built-in
// cursor in MUSICAL TIME without this component re-rendering on every animation frame.
//
// CURSOR MODEL (brief section 13): OSMD's cursor walks "voice entries" in score order.
// Our Line is single-voice and every LineNote (including rests) becomes exactly one
// voice entry, so the cursor's k-th step corresponds to line.notes[k]. We therefore
// track the cursor's logical index ourselves (count of next() calls since reset) and
// the read-along loop just asks us to move TO a target index — we step next()/reset()
// to reach it. This keeps the cursor tight to the precomputed schedule and never
// re-queries OSMD geometry per frame.

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { Line } from '../../domain/index.js';
import { serializeLineToMusicXML } from '../../musicxml/serialize.js';

/** Imperative API the read-along loop uses to drive the cursor in musical time. */
export interface CursorHandle {
  /** Park the cursor at the start, hidden (count-in: line not yet started). */
  reset(): void;
  /** Make the cursor visible (call when the line's first note begins). */
  show(): void;
  /** Hide the cursor. */
  hide(): void;
  /**
   * Move the cursor so it sits on note index `target` (index into line.notes).
   * Idempotent and cheap if already there; steps forward/back as needed.
   * Pass -1 to park at the start (before the first note).
   */
  moveTo(target: number): void;
  /** Dim the staff region behind the cursor up to `target` (read-ahead cue). Optional. */
  currentIndex(): number;
}

export interface OsmdViewProps {
  line: Line | null;
  /** Called once OSMD has finished (re-)rendering the current line. */
  onRendered?: (line: Line) => void;
}

/** OSMD render + cursor host. */
export const OsmdView = forwardRef<CursorHandle, OsmdViewProps>(
  function OsmdView({ line, onRendered }, ref): React.JSX.Element {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
    // The cursor's current logical index into line.notes (-1 == parked before start).
    const cursorIndexRef = useRef<number>(-1);
    // Number of voice entries OSMD walked for the current line (== notes.length).
    const entryCountRef = useRef<number>(0);
    const onRenderedRef = useRef<typeof onRendered>(onRendered);
    onRenderedRef.current = onRendered;

    // (Re)create OSMD once for the lifetime of the container element.
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      console.log('[UI] OsmdView: creating OpenSheetMusicDisplay');
      const osmd = new OpenSheetMusicDisplay(container, {
        autoResize: true,
        backend: 'svg',
        drawTitle: false,
        drawPartNames: false,
        followCursor: true,
        // A bold, unambiguous cursor that reads at a distance (brief section 13).
        cursorsOptions: [
          { type: 0, color: '#4f9cff', alpha: 0.45, follow: true },
        ],
      });
      osmdRef.current = osmd;
      return () => {
        // OSMD has no full teardown; drop the reference and clear the container.
        osmdRef.current = null;
        container.innerHTML = '';
      };
    }, []);

    // Render whenever the line changes.
    useEffect(() => {
      const osmd = osmdRef.current;
      if (!osmd || !line) return;
      let cancelled = false;
      const xml = serializeLineToMusicXML(line);
      console.log(
        `[UI] OsmdView: rendering line ${line.id} (${line.notes.length} notes, ${line.barCount} bars)`,
      );
      void osmd
        .load(xml)
        .then(() => {
          if (cancelled) return;
          osmd.render();
          // Initialize the cursor and count how many voice entries it walks; for a
          // single-voice line this equals line.notes.length and lets us assert the
          // 1:1 mapping the read-along loop relies on.
          const cursor = osmd.cursor;
          cursor.reset();
          cursor.hide();
          let count = 0;
          // Walk to the end to count entries, then reset.
          while (!cursor.iterator.EndReached) {
            count++;
            cursor.next();
            if (count > line.notes.length + 8) break; // safety
          }
          cursor.reset();
          cursor.hide();
          entryCountRef.current = count;
          cursorIndexRef.current = -1;
          if (count !== line.notes.length) {
            console.warn(
              `[UI] OsmdView: cursor entry count ${count} != notes ${line.notes.length} ` +
                `(cursor index will be clamped; check for chords/ties in the line)`,
            );
          } else {
            console.log(
              `[UI] OsmdView: cursor mapping OK (${count} entries == ${line.notes.length} notes)`,
            );
          }
          onRenderedRef.current?.(line);
        })
        .catch((err: unknown) => {
          console.error('[UI] OsmdView: OSMD load/render failed', err);
        });
      return () => {
        cancelled = true;
      };
    }, [line]);

    useImperativeHandle(
      ref,
      (): CursorHandle => ({
        reset(): void {
          const osmd = osmdRef.current;
          if (!osmd) return;
          osmd.cursor.reset();
          osmd.cursor.hide();
          cursorIndexRef.current = -1;
        },
        show(): void {
          osmdRef.current?.cursor.show();
        },
        hide(): void {
          osmdRef.current?.cursor.hide();
        },
        moveTo(target: number): void {
          const osmd = osmdRef.current;
          if (!osmd) return;
          const count = entryCountRef.current;
          const clamped =
            count > 0 ? Math.min(Math.max(target, -1), count - 1) : -1;
          let cur = cursorIndexRef.current;
          if (clamped === cur) return;
          const cursor = osmd.cursor;
          // Stepping backward is only needed on reset/replay; cheaper to reset+forward.
          if (clamped < cur) {
            cursor.reset();
            cur = -1;
          }
          while (cur < clamped && !cursor.iterator.EndReached) {
            cursor.next();
            cur++;
          }
          cursor.update();
          cursorIndexRef.current = cur;
        },
        currentIndex(): number {
          return cursorIndexRef.current;
        },
      }),
      [],
    );

    return <div className="osmd-container" ref={containerRef} />;
  },
);
