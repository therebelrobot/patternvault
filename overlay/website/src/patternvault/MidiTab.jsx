import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cx from '@src/cx.mjs';
import { midiToName } from './chords.mjs';
import { groupEvents, render, MODES } from './midinotation.mjs';
import { CodeOut, Row, Select } from './ui.jsx';

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;

export function MidiTab({ context }) {
  const [access, setAccess] = useState(null);
  const [error, setError] = useState(null);
  const [inputs, setInputs] = useState([]);
  const [inputId, setInputId] = useState('');
  const [held, setHeld] = useState([]);
  const [events, setEvents] = useState([]);
  const [recording, setRecording] = useState(false);
  const [mode, setMode] = useState('sequence');
  const [prefer, setPrefer] = useState('sharp');
  const [rests, setRests] = useState(false);

  // Read inside the message handler without re-subscribing on every note.
  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  const startRef = useRef(0);

  const supported = typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';

  const connect = useCallback(async () => {
    setError(null);
    if (!supported) {
      setError(
        window.isSecureContext === false
          ? 'Web MIDI needs a secure context. This page is on plain http, so the browser withholds it — serve over https or use localhost.'
          : 'This browser has no Web MIDI support. Firefox requires it to be enabled; Safari does not implement it.',
      );
      return;
    }
    try {
      const midi = await navigator.requestMIDIAccess({ sysex: false });
      setAccess(midi);
      const list = [...midi.inputs.values()].map((i) => ({ id: i.id, name: i.name || i.id }));
      setInputs(list);
      setInputId((cur) => cur || list[0]?.id || '');
      midi.onstatechange = () => {
        const next = [...midi.inputs.values()].map((i) => ({ id: i.id, name: i.name || i.id }));
        setInputs(next);
      };
    } catch (err) {
      setError(err?.message ?? String(err));
    }
  }, [supported]);

  useEffect(() => {
    if (!access || !inputId) return;
    const input = access.inputs.get(inputId);
    if (!input) return;

    const onMessage = (e) => {
      const [status, note, velocity] = e.data;
      const kind = status & 0xf0;
      // Running status: a note-on at velocity 0 is a note-off.
      const isOn = kind === NOTE_ON && velocity > 0;
      const isOff = kind === NOTE_OFF || (kind === NOTE_ON && velocity === 0);

      if (isOn) {
        setHeld((h) => (h.includes(note) ? h : [...h, note].sort((a, b) => a - b)));
        if (recordingRef.current) {
          const t = performance.now() - startRef.current;
          setEvents((evs) => [...evs, { midi: note, time: t, velocity }]);
        }
      } else if (isOff) {
        setHeld((h) => h.filter((n) => n !== note));
      }
    };

    input.addEventListener('midimessage', onMessage);
    return () => input.removeEventListener('midimessage', onMessage);
  }, [access, inputId]);

  const groups = useMemo(() => groupEvents(events), [events]);
  const code = useMemo(() => render(groups, mode, { prefer, rests }), [groups, mode, prefer, rests]);

  const insert = context?.editorRef?.current
    ? () => {
        const view = context.editorRef.current?.editor;
        if (!view?.state) return;
        view.dispatch(view.state.replaceSelection(code));
      }
    : null;

  return (
    <div className="w-full h-full text-foreground flex flex-col overflow-auto px-2 py-2 gap-3">
      {!access && (
        <div className="flex flex-col gap-2 max-w-md">
          <button className="hover:opacity-50 text-sm self-start" onClick={connect}>
            connect midi
          </button>
          <p className="text-xs opacity-50">
            The browser asks for permission once. Nothing is sent anywhere — note messages are read in this tab and
            turned into text.
          </p>
        </div>
      )}

      {error && <p className="text-xs text-red-400 max-w-md">{error}</p>}

      {access && (
        <>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <Row label="input">
              <Select
                value={inputId}
                onChange={setInputId}
                options={
                  inputs.length
                    ? inputs.map((i) => ({ value: i.id, label: i.name }))
                    : [{ value: '', label: 'no devices found' }]
                }
              />
            </Row>
            <Row label="spelling">
              <Select
                value={prefer}
                onChange={setPrefer}
                options={[
                  { value: 'sharp', label: 'sharps' },
                  { value: 'flat', label: 'flats' },
                ]}
              />
            </Row>
          </div>

          <div className="flex items-center gap-3 text-sm flex-wrap">
            <button
              className={cx('hover:opacity-50', recording && 'text-red-400')}
              onClick={() => {
                if (!recording) {
                  setEvents([]);
                  startRef.current = performance.now();
                }
                setRecording((r) => !r);
              }}
            >
              {recording ? 'stop' : 'record'}
            </button>
            <button className="hover:opacity-50" onClick={() => setEvents([])} disabled={!events.length}>
              clear
            </button>
            <span className="opacity-60">
              {events.length} note{events.length === 1 ? '' : 's'} in {groups.length} step
              {groups.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="flex items-baseline gap-3 min-h-6">
            <span className="opacity-60 text-sm">holding</span>
            <span className="text-lg tracking-wide">
              {held.length ? held.map((n) => midiToName(n, prefer)).join('  ') : <span className="opacity-30">—</span>}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 max-w-md">
            <Row label="output as">
              <Select value={mode} onChange={setMode} options={MODES.map((m) => ({ value: m.id, label: m.label }))} />
            </Row>
            <Row label="gaps">
              <Select
                value={rests ? 'yes' : 'no'}
                onChange={(v) => setRests(v === 'yes')}
                options={[
                  { value: 'no', label: 'ignore timing' },
                  { value: 'yes', label: 'fill with rests' },
                ]}
              />
            </Row>
          </div>

          <div className="max-w-md">
            <CodeOut code={code} label="strudel" onInsert={insert} empty="play something with record on" />
          </div>

          <p className="text-xs opacity-50 max-w-md">
            Onsets within 40ms collapse into one step, so a strummed chord reads as a chord. Rests are quantised against
            the shortest gap in the take.
          </p>
        </>
      )}
    </div>
  );
}
