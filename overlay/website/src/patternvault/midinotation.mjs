// Captured MIDI events -> Strudel mini-notation. Pure, so it can be tested
// without a MIDI device attached.

import { midiToName } from './chords.mjs';

/**
 * Collapse note-ons that landed close enough together into one step.
 * Nobody plays a chord perfectly simultaneously; 40ms is roughly the window
 * inside which a human means "at the same time".
 *
 * @param {{midi: number, time: number}[]} events  sorted or not
 * @param {number} groupMs
 * @returns {{notes: number[], time: number}[]}
 */
export function groupEvents(events, groupMs = 40) {
  const sorted = [...events].sort((a, b) => a.time - b.time);
  const groups = [];
  for (const ev of sorted) {
    const last = groups[groups.length - 1];
    if (last && ev.time - last.time <= groupMs) {
      if (!last.notes.includes(ev.midi)) last.notes.push(ev.midi);
    } else {
      groups.push({ notes: [ev.midi], time: ev.time });
    }
  }
  return groups.map((g) => ({ ...g, notes: g.notes.sort((a, b) => a - b) }));
}

const nameOf = (midi, prefer) => midiToName(midi, prefer);

function step(notes, prefer) {
  if (notes.length === 1) return nameOf(notes[0], prefer);
  return `[${notes.map((n) => nameOf(n, prefer)).join(',')}]`;
}

/**
 * Gaps become rests, quantised against the shortest gap in the take. Capped,
 * because one long pause before the last note should not emit forty tildes.
 */
function restsBetween(gapMs, unitMs, max = 8) {
  if (!unitMs || gapMs <= unitMs * 1.5) return 0;
  return Math.min(max, Math.round(gapMs / unitMs) - 1);
}

export function toSequence(groups, { prefer = 'sharp', rests = false } = {}) {
  if (!groups.length) return '';
  const gaps = groups.slice(1).map((g, i) => g.time - groups[i].time);
  const unit = gaps.length ? Math.min(...gaps) : 0;

  const parts = [];
  groups.forEach((g, i) => {
    if (rests && i > 0) {
      for (let r = 0; r < restsBetween(groups[i].time - groups[i - 1].time, unit); r++) parts.push('~');
    }
    parts.push(step(g.notes, prefer));
  });
  return `note("${parts.join(' ')}")`;
}

export function toChord(groups, { prefer = 'sharp' } = {}) {
  const notes = [...new Set(groups.flatMap((g) => g.notes))].sort((a, b) => a - b);
  if (!notes.length) return '';
  return `note("${step(notes, prefer)}")`;
}

// One cycle per step is the readable default for a long take.
export function toSlowSequence(groups, opts = {}) {
  const seq = toSequence(groups, opts);
  if (!seq) return '';
  return `${seq}.slow(${groups.length})`;
}

export function render(groups, mode, opts = {}) {
  switch (mode) {
    case 'chord':
      return toChord(groups, opts);
    case 'slow':
      return toSlowSequence(groups, opts);
    case 'sequence':
    default:
      return toSequence(groups, opts);
  }
}

export const MODES = [
  { id: 'sequence', label: 'sequence — one step per onset' },
  { id: 'chord', label: 'chord — everything stacked' },
  { id: 'slow', label: 'sequence, one step per cycle' },
];
