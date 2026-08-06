import { useMemo, useState } from 'react';
import cx from '@src/cx.mjs';
import { ROOTS, QUALITIES, STYLES, chordNotes, chordMidi, toStrudel, isExactlySpelled } from './chords.mjs';
import { playNotes } from './audio.mjs';
import { CodeOut, Row, Select } from './ui.jsx';

export function ChordTab({ context }) {
  const [root, setRoot] = useState('C');
  const [quality, setQuality] = useState('maj7');
  const [octave, setOctave] = useState(3);
  const [inversion, setInversion] = useState(0);
  const [style, setStyle] = useState('stack');
  const [rolled, setRolled] = useState(false);

  const opts = { root, quality, octave, inversion };
  const notes = useMemo(() => chordNotes(opts), [root, quality, octave, inversion]);
  const midi = useMemo(() => chordMidi(opts), [root, quality, octave, inversion]);
  const code = useMemo(() => toStrudel(opts, style), [root, quality, octave, inversion, style]);
  const exact = isExactlySpelled(opts);

  const maxInversion = Math.max(0, (QUALITIES.find((q) => q.id === quality)?.intervals.length ?? 3) - 1);

  // Drop the chord at the cursor if the editor exposes a way in; otherwise
  // the copy button is the path.
  const insert = context?.editorRef?.current
    ? () => {
        const view = context.editorRef.current?.editor;
        const state = view?.state;
        if (!state) return;
        view.dispatch(state.replaceSelection(code));
      }
    : null;

  return (
    <div className="w-full h-full text-foreground flex flex-col overflow-auto px-2 py-2 gap-3">
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <Row label="root">
          <Select value={root} onChange={setRoot} options={ROOTS.map((r) => ({ value: r.name, label: r.name }))} />
        </Row>
        <Row label="quality">
          <Select
            value={quality}
            onChange={(q) => {
              setQuality(q);
              setInversion(0);
            }}
            options={QUALITIES.map((q) => ({ value: q.id, label: q.label }))}
          />
        </Row>
        <Row label="octave">
          <Select
            value={String(octave)}
            onChange={(v) => setOctave(Number(v))}
            options={[1, 2, 3, 4, 5, 6].map((o) => ({ value: String(o), label: String(o) }))}
          />
        </Row>
        <Row label="inversion">
          <Select
            value={String(inversion)}
            onChange={(v) => setInversion(Number(v))}
            options={Array.from({ length: maxInversion + 1 }, (_, i) => ({
              value: String(i),
              label: i === 0 ? 'root position' : `${i}${i === 1 ? 'st' : i === 2 ? 'nd' : i === 3 ? 'rd' : 'th'}`,
            }))}
          />
        </Row>
      </div>

      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-lg tracking-wide">{notes.join('  ')}</span>
        <button className="hover:opacity-50 text-sm" onClick={() => playNotes(midi, { stagger: rolled ? 0.09 : 0 })}>
          play
        </button>
        <button className={cx('hover:opacity-50 text-sm', rolled && 'underline')} onClick={() => setRolled((r) => !r)}>
          {rolled ? 'rolled' : 'block'}
        </button>
      </div>

      {!exact && (
        <p className="text-xs opacity-50 max-w-md">
          Strictly this chord needs a double accidental, which Strudel&apos;s note parser may not accept — showing the
          enharmonic equivalent instead. It sounds identical.
        </p>
      )}

      <div className="max-w-md">
        <Row label="output as">
          <Select value={style} onChange={setStyle} options={STYLES.map((s) => ({ value: s.id, label: s.label }))} />
        </Row>
      </div>

      <div className="max-w-md">
        <CodeOut code={code} label="strudel" onInsert={insert} />
      </div>

      {style === 'chord' && (
        <p className="text-xs opacity-50 max-w-md">
          <code>chord().voicing()</code> picks its own voicing, so the inversion and octave above are ignored in this
          form. It needs <code>@strudel/tonal</code>, which the REPL already loads.
        </p>
      )}
    </div>
  );
}
