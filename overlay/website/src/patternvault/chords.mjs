// Chord spelling and Strudel notation. No React, no audio, no DOM — this is
// the part worth testing, so it stays importable on its own.

export const SHARP_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
export const FLAT_NAMES = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];

// Roots offered in the picker, with the accidental each one is normally
// spelled with. Db major is not C# major on paper, even though it sounds so.
export const ROOTS = [
  { name: 'C', pc: 0, prefer: 'sharp' },
  { name: 'C#', pc: 1, prefer: 'sharp' },
  { name: 'Db', pc: 1, prefer: 'flat' },
  { name: 'D', pc: 2, prefer: 'sharp' },
  { name: 'Eb', pc: 3, prefer: 'flat' },
  { name: 'E', pc: 4, prefer: 'sharp' },
  { name: 'F', pc: 5, prefer: 'flat' },
  { name: 'F#', pc: 6, prefer: 'sharp' },
  { name: 'Gb', pc: 6, prefer: 'flat' },
  { name: 'G', pc: 7, prefer: 'sharp' },
  { name: 'Ab', pc: 8, prefer: 'flat' },
  { name: 'A', pc: 9, prefer: 'sharp' },
  { name: 'Bb', pc: 10, prefer: 'flat' },
  { name: 'B', pc: 11, prefer: 'sharp' },
];

// `symbol` is what gets appended to the root for the chord() form, and it
// matches the chord-symbol vocabulary tonal understands.
export const QUALITIES = [
  { id: 'maj', label: 'major', symbol: '', intervals: [0, 4, 7] , degrees: [1, 3, 5] },
  { id: 'min', label: 'minor', symbol: 'm', intervals: [0, 3, 7] , degrees: [1, 3, 5] },
  { id: 'dim', label: 'diminished', symbol: 'dim', intervals: [0, 3, 6] , degrees: [1, 3, 5] },
  { id: 'aug', label: 'augmented', symbol: 'aug', intervals: [0, 4, 8] , degrees: [1, 3, 5] },
  { id: 'sus2', label: 'sus2', symbol: 'sus2', intervals: [0, 2, 7] , degrees: [1, 2, 5] },
  { id: 'sus4', label: 'sus4', symbol: 'sus4', intervals: [0, 5, 7] , degrees: [1, 4, 5] },
  { id: '6', label: 'sixth', symbol: '6', intervals: [0, 4, 7, 9] , degrees: [1, 3, 5, 6] },
  { id: 'm6', label: 'minor sixth', symbol: 'm6', intervals: [0, 3, 7, 9] , degrees: [1, 3, 5, 6] },
  { id: '7', label: 'dominant 7th', symbol: '7', intervals: [0, 4, 7, 10] , degrees: [1, 3, 5, 7] },
  { id: 'maj7', label: 'major 7th', symbol: 'maj7', intervals: [0, 4, 7, 11] , degrees: [1, 3, 5, 7] },
  { id: 'm7', label: 'minor 7th', symbol: 'm7', intervals: [0, 3, 7, 10] , degrees: [1, 3, 5, 7] },
  { id: 'm7b5', label: 'half-diminished', symbol: 'm7b5', intervals: [0, 3, 6, 10] , degrees: [1, 3, 5, 7] },
  { id: 'dim7', label: 'diminished 7th', symbol: 'dim7', intervals: [0, 3, 6, 9] , degrees: [1, 3, 5, 7] },
  { id: 'add9', label: 'add9', symbol: 'add9', intervals: [0, 4, 7, 14] , degrees: [1, 3, 5, 9] },
  { id: '9', label: 'dominant 9th', symbol: '9', intervals: [0, 4, 7, 10, 14] , degrees: [1, 3, 5, 7, 9] },
  { id: 'maj9', label: 'major 9th', symbol: 'maj9', intervals: [0, 4, 7, 11, 14] , degrees: [1, 3, 5, 7, 9] },
  { id: 'm9', label: 'minor 9th', symbol: 'm9', intervals: [0, 3, 7, 10, 14] , degrees: [1, 3, 5, 7, 9] },
  { id: '11', label: 'dominant 11th', symbol: '11', intervals: [0, 4, 7, 10, 14, 17] , degrees: [1, 3, 5, 7, 9, 11] },
  { id: '13', label: 'dominant 13th', symbol: '13', intervals: [0, 4, 7, 10, 14, 21] , degrees: [1, 3, 5, 7, 9, 13] },
];

export const getQuality = (id) => QUALITIES.find((q) => q.id === id) ?? QUALITIES[0];
export const getRoot = (name) => ROOTS.find((r) => r.name === name) ?? ROOTS[0];

// MIDI 60 is c4, so octave n starts at 12 * (n + 1).
export function midiOf(pc, octave) {
  return 12 * (octave + 1) + pc;
}

// --- interval spelling -----------------------------------------------------
// Pitch-class lookup gets C7 wrong: it spells the seventh a#, when a dominant
// seventh is b-flat. Correct spelling gives every chord tone its own letter,
// derived from its scale degree, and adds whatever accidental makes the
// arithmetic work.

const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
const LETTER_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

function parseRoot(name) {
  const letter = name[0].toLowerCase();
  const accidental = name.slice(1);
  const alter = (accidental.match(/#/g)?.length ?? 0) - (accidental.match(/b/g)?.length ?? 0);
  return { letterIndex: LETTERS.indexOf(letter), alter };
}

function accidentalString(alter) {
  if (alter === 0) return '';
  return alter > 0 ? '#'.repeat(alter) : 'b'.repeat(-alter);
}

// Spell one chord tone: `degree` picks the letter, `semitones` fixes the pitch.
export function spell(rootName, degree, semitones, rootOctave) {
  const root = parseRoot(rootName);
  const steps = degree - 1;
  const letterIndex = (root.letterIndex + steps) % 7;
  const letterOctaves = Math.floor((root.letterIndex + steps) / 7);

  const rootSemis = LETTER_SEMITONES[root.letterIndex] + root.alter;
  const naturalSemis = LETTER_SEMITONES[letterIndex] + 12 * letterOctaves;
  const alter = rootSemis + semitones - naturalSemis;

  // Double accidentals are correct on paper (Cdim7's seventh is b-double-flat)
  // but Strudel's note parser is not guaranteed to accept them, and an
  // unplayable string is worse than an enharmonic one. Fall back to the plain
  // pitch-class name in that case.
  if (Math.abs(alter) > 1) {
    const midi = midiOf(((rootSemis + semitones) % 12 + 12) % 12, rootOctave) + 12 * Math.floor((rootSemis + semitones) / 12);
    return { name: midiToName(midi, alter < 0 ? 'flat' : 'sharp'), exact: false };
  }
  return { name: `${LETTERS[letterIndex]}${accidentalString(alter)}${rootOctave + letterOctaves}`, exact: true };
}

export function midiToName(midi, prefer = 'sharp') {
  const table = prefer === 'flat' ? FLAT_NAMES : SHARP_NAMES;
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${table[pc]}${octave}`;
}

// Inversion rotates the stack: the lowest note jumps up an octave, once per
// inversion, which is what a keyboard player actually does.
export function chordMidi({ root = 'C', quality = 'maj', octave = 3, inversion = 0 } = {}) {
  const r = getRoot(root);
  const q = getQuality(quality);
  const base = midiOf(r.pc, octave);
  let notes = q.intervals.map((i) => base + i);
  const n = notes.length;
  for (let k = 0; k < inversion % n; k++) {
    notes = [...notes.slice(1), notes[0] + 12];
  }
  return notes;
}

// Spelled note names, in the order the inversion puts them.
export function chordNotes({ root = 'C', quality = 'maj', octave = 3, inversion = 0 } = {}) {
  const q = getQuality(quality);
  let tones = q.intervals.map((semitones, i) => ({
    semitones,
    degree: q.degrees[i],
    octaveShift: 0,
  }));
  const n = tones.length;
  for (let k = 0; k < inversion % n; k++) {
    const [low, ...rest] = tones;
    tones = [...rest, { ...low, semitones: low.semitones + 12, octaveShift: low.octaveShift + 1 }];
  }
  return tones.map((t) => spell(root, t.degree + 7 * t.octaveShift, t.semitones, octave).name);
}

// True when every tone could be spelled without a double accidental.
export function isExactlySpelled({ root = 'C', quality = 'maj', octave = 3 } = {}) {
  const q = getQuality(quality);
  return q.intervals.every((semitones, i) => spell(root, q.degrees[i], semitones, octave).exact);
}

export function chordSymbol({ root = 'C', quality = 'maj' } = {}) {
  return `${getRoot(root).name}${getQuality(quality).symbol}`;
}

export const STYLES = [
  { id: 'stack', label: 'stacked — all at once' },
  { id: 'seq', label: 'sequence — one per step' },
  { id: 'arp', label: 'alternate — one per cycle' },
  { id: 'chord', label: 'chord() + voicing()' },
];

export function toStrudel(opts = {}, style = 'stack') {
  const notes = chordNotes(opts);
  switch (style) {
    case 'seq':
      return `note("${notes.join(' ')}")`;
    case 'arp':
      return `note("<${notes.join(' ')}>")`;
    case 'chord':
      // Lets Strudel voice it; ignores the inversion picked above, since
      // voicing() decides its own.
      return `chord("${chordSymbol(opts)}").voicing()`;
    case 'stack':
    default:
      return `note("[${notes.join(',')}]")`;
  }
}
