import { useState } from 'react';
import cx from '@src/cx.mjs';

// Both new panels end the same way: here is the notation, take it. Shared so
// the copy affordance behaves identically in both.
export function CodeOut({ code, label = 'notation', onInsert, empty = 'nothing to show yet' }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // clipboard API needs a secure context and permission; fall back to
      // the old selection trick so plain-http LAN users are not stuck.
      const ta = document.createElement('textarea');
      ta.value = code;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(ta);
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3 text-sm">
        <span className="opacity-60">{label}</span>
        <span className="flex-grow" />
        {onInsert && (
          <button className="hover:opacity-50" onClick={onInsert} disabled={!code}>
            insert
          </button>
        )}
        <button className="hover:opacity-50" onClick={copy} disabled={!code}>
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre
        className={cx(
          'bg-background border border-muted rounded px-2 py-1 text-foreground text-sm overflow-x-auto whitespace-pre-wrap break-all',
          !code && 'opacity-40',
        )}
      >
        {code || empty}
      </pre>
    </div>
  );
}

export function Row({ label, children }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="opacity-60">{label}</span>
      {children}
    </label>
  );
}

export function Select({ value, onChange, options }) {
  return (
    <select
      className="bg-background border border-muted rounded px-2 py-1 text-foreground"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
