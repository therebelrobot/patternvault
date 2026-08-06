// A tiny preview synth, deliberately independent of Strudel's audio engine.
//
// Reaching into superdough would couple this panel to internals that move,
// and the panel only needs "is this the chord I meant?" — a triangle wave
// with an envelope answers that. Browsers allow a second AudioContext, and
// this one stays suspended until the first click.

let ctx = null;

export function previewContext() {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

export const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * @param {number[]} midiNotes
 * @param {{duration?: number, stagger?: number, gain?: number}} opts
 *   stagger > 0 rolls the chord, which is how you hear a voicing rather than
 *   a block of sound.
 */
export function playNotes(midiNotes, { duration = 1.4, stagger = 0, gain = 0.18 } = {}) {
  const audio = previewContext();
  if (!audio) return false;
  // Autoplay policy suspends contexts created outside a gesture; this runs
  // from a click, so resuming here is allowed.
  if (audio.state === 'suspended') audio.resume();

  const now = audio.currentTime + 0.02;
  const master = audio.createGain();
  master.gain.value = 1;
  master.connect(audio.destination);

  midiNotes.forEach((midi, i) => {
    const start = now + i * stagger;
    const osc = audio.createOscillator();
    const env = audio.createGain();
    osc.type = 'triangle';
    osc.frequency.value = midiToFreq(midi);

    // Per-voice envelope, scaled down by voice count so a 13th chord is not
    // four times louder than a triad.
    const peak = gain / Math.max(1, Math.sqrt(midiNotes.length));
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(peak, start + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(env);
    env.connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  });

  return true;
}

export function stopPreview() {
  if (ctx && ctx.state === 'running') {
    ctx.close();
    ctx = null;
  }
}
