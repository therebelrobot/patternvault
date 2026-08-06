import { ChordTab } from './ChordTab.jsx';
import { MidiTab } from './MidiTab.jsx';

// Merged into upstream's `tabNames`, which is what renders the tab strip —
// `Tabs` maps over Object.keys(tabNames), so adding here adds the button, the
// ordering, and the persisted `activeFooter` value in one go.
export const patternvaultTabNames = {
  chords: 'pv-chords',
  midi: 'pv-midi',
};

/**
 * Called from PanelContent after its hooks have run. Returns an element for
 * our tabs and null for everything else, so upstream's switch is untouched.
 *
 * This is a plain function, not a hook — it must be safe to call before an
 * early return without changing React's hook order.
 */
export function patternvaultTab(tab, context) {
  switch (tab) {
    case patternvaultTabNames.chords:
      return <ChordTab context={context} />;
    case patternvaultTabNames.midi:
      return <MidiTab context={context} />;
    default:
      return null;
  }
}
