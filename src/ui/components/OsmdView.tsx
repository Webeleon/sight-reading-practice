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
import type { Note } from 'opensheetmusicdisplay';
import type { Line } from '../../domain/index.js';
import { serializeLineToMusicXML } from '../../musicxml/serialize.js';

/**
 * Notehead colours for the three real-time feedback states (brief section 13):
 * strong, unambiguous, readable at a distance. Exposed as named constants so the
 * human can recolor without hunting through logic.
 *
 * Recoloured to the "Signal Tape" palette (design/signal-tape.css two-colour
 * discipline): ink is the engraved default, ULTRAMARINE marks a correct hit
 * (structure/data), FLUX ORANGE marks a wrong note (energy/feedback — the same
 * orange used for the live note + cursor), and faded ink greys out a miss.
 * Only the colour VALUES change here; the feedback states + logic are untouched.
 */
export const FEEDBACK_COLORS = {
  hit: '#1d3df0', // ultramarine: correct pitch in time
  wrong: '#ff5b1f', // flux orange: something at the right time, wrong pitch
  missed: '#8a8478', // faded ink: nothing detected
  /** Default (un-evaluated) notehead colour OSMD uses. */
  neutral: '#141210', // ink: the engraved default
} as const;

/** Feedback colour key for a single note (or null to leave it neutral). */
export type NoteFeedback = 'hit' | 'wrong' | 'missed' | null;

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
  /**
   * Read-ahead cue (brief section 13: "after a note is evaluated, slightly dim
   * the region behind the cursor"). `fraction` in [0,1] is how far the cursor has
   * progressed through the line (== currentIndex / lastIndex); the staff area to
   * the LEFT of that point is dimmed via a translucent overlay so the eye is
   * pulled forward to the notes still to come. Pass 0 to clear the dim. Cheap: it
   * just repositions a CSS overlay; it never re-renders OSMD.
   */
  setReadAheadDim(fraction: number): void;
  /** The cursor's current logical index into line.notes (-1 == parked before start). */
  currentIndex(): number;
  /**
   * Recolour noteheads by note index (index into line.notes). Sets each given
   * note's colour and re-renders ONCE. Indices not present are left unchanged.
   * Pass 'hit'/'wrong'/'missed' (see FEEDBACK_COLORS); used both for live
   * trailing feedback (a note or two at a time) and the final results screen
   * (all notes at once).
   */
  colorNotes(feedbackByIndex: ReadonlyMap<number, NoteFeedback>): void;
  /** Clear all feedback colours back to neutral and re-render. */
  clearColors(): void;
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
    // Translucent overlay that dims the already-read region behind the cursor.
    const dimOverlayRef = useRef<HTMLDivElement | null>(null);
    const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
    // The cursor's current logical index into line.notes (-1 == parked before start).
    const cursorIndexRef = useRef<number>(-1);
    // Number of voice entries OSMD walked for the current line (== notes.length).
    const entryCountRef = useRef<number>(0);
    // Flat list of OSMD source Notes in score order, so note index N (into
    // line.notes) maps to sourceNotesRef.current[N] for recolouring.
    const sourceNotesRef = useRef<Note[]>([]);
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
        // Signal Tape: FLUX ORANGE marks the live/current note (the same colour as
        // the design's .cursor + .note.is-live). Colour only — behaviour unchanged.
        cursorsOptions: [
          { type: 0, color: '#ff5b1f', alpha: 0.28, follow: true },
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
          // Collect the source notes in score order so we can recolour by index.
          sourceNotesRef.current = collectSourceNotes(osmd);
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
          if (count <= 0) return;
          // OSMD's cursor always sits ON an entry; "before the first note" (-1) is not
          // representable, so the read-along loop expresses count-in by hide()ing
          // instead. Clamp move targets to a real entry.
          const clamped = Math.min(Math.max(target, 0), count - 1);
          let cur = cursorIndexRef.current;
          if (clamped === cur) return;
          const cursor = osmd.cursor;
          // CRUCIAL: cursor.reset() lands ON entry 0, NOT before it. So when we step
          // backward (reset) or we're parked (cur < 0, where OSMD already sits on entry
          // 0 from the last reset/load), our logical index is 0 with NO extra next().
          // (The previous code treated post-reset as -1 and over-advanced by one, which
          // made the cursor start on the second note instead of the downbeat.)
          if (clamped < cur) {
            cursor.reset();
            cur = 0;
          } else if (cur < 0) {
            cur = 0;
          }
          while (cur < clamped && !cursor.iterator.EndReached) {
            cursor.next();
            cur++;
          }
          cursor.update();
          cursorIndexRef.current = cur;
        },
        setReadAheadDim(fraction: number): void {
          const overlay = dimOverlayRef.current;
          if (!overlay) return;
          const f = Math.min(1, Math.max(0, fraction));
          if (f <= 0) {
            overlay.style.opacity = '0';
            overlay.style.width = '0%';
            return;
          }
          // A soft, narrow band of dimming just behind the cursor (not a hard
          // wall) — enough to de-emphasise the read region without hiding it, so
          // the player can still glance back. Width tracks cursor progress.
          overlay.style.width = `${(f * 100).toFixed(2)}%`;
          overlay.style.opacity = '1';
        },
        currentIndex(): number {
          return cursorIndexRef.current;
        },
        colorNotes(feedbackByIndex): void {
          const osmd = osmdRef.current;
          if (!osmd) return;
          const notes = sourceNotesRef.current;
          let changed = false;
          for (const [index, fb] of feedbackByIndex) {
            const note = notes[index];
            if (!note || fb === null) continue;
            note.NoteheadColor = FEEDBACK_COLORS[fb];
            changed = true;
          }
          if (!changed) return;
          // Re-render once to repaint the recoloured noteheads. The cursor logical
          // index is preserved across render in OSMD; restore its visual position.
          const keepIndex = cursorIndexRef.current;
          osmd.render();
          if (keepIndex >= 0) {
            // After render the cursor object persists; re-point it to keepIndex.
            // CRUCIAL (same off-by-one as moveTo): cursor.reset() lands ON entry 0,
            // NOT before it, so our logical index after reset is 0 with NO extra
            // next(). The previous code anchored cur=-1 and ran the loop one extra
            // time, leaving the cursor on keepIndex+1 (the bug Item-1 fixes).
            const cursor = osmd.cursor;
            cursor.reset();
            let cur = 0;
            while (cur < keepIndex && !cursor.iterator.EndReached) {
              cursor.next();
              cur++;
            }
            cursor.update();
            cursorIndexRef.current = cur;
          }
        },
        clearColors(): void {
          const osmd = osmdRef.current;
          if (!osmd) return;
          for (const note of sourceNotesRef.current) {
            note.NoteheadColor = FEEDBACK_COLORS.neutral;
          }
          osmd.render();
          cursorIndexRef.current = -1;
          // Clear the read-ahead dim too (fresh line / retry starts un-dimmed).
          const overlay = dimOverlayRef.current;
          if (overlay) {
            overlay.style.opacity = '0';
            overlay.style.width = '0%';
          }
        },
      }),
      [],
    );

    return (
      <div className="osmd-wrap">
        <div className="osmd-container" ref={containerRef} />
        {/* Read-ahead dim: a translucent band over the already-read region,
            sized/shown imperatively via setReadAheadDim (no re-render). */}
        <div
          className="osmd-readahead-dim"
          ref={dimOverlayRef}
          style={{ opacity: 0, width: '0%' }}
          aria-hidden="true"
        />
      </div>
    );
  },
);

/**
 * Walk the loaded MusicSheet and return every source Note in score order. For our
 * single-voice line this list lines up 1:1 with line.notes (rests included), so
 * the k-th entry is line.notes[k]. Used to recolour noteheads by note index.
 */
function collectSourceNotes(osmd: OpenSheetMusicDisplay): Note[] {
  const out: Note[] = [];
  const sheet = osmd.Sheet;
  if (!sheet) return out;
  for (const measure of sheet.SourceMeasures) {
    for (const container of measure.VerticalSourceStaffEntryContainers) {
      for (const staffEntry of container.StaffEntries) {
        if (!staffEntry) continue;
        for (const voiceEntry of staffEntry.VoiceEntries) {
          for (const note of voiceEntry.Notes) {
            out.push(note);
          }
        }
      }
    }
  }
  return out;
}
