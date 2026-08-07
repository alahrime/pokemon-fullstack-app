import { useState } from 'react';
import {
  CUSTOM_GROUNDS, CUSTOM_SIGNALS, adaptSignal, buildPalette, contrast, customBase,
  signalRejection, type CustomChoice,
} from '../lib/palette';
import { useTheme } from '../state/ThemeContext';

/**
 * Build your own palette, three choices deep.
 *
 * Ground first, then two signals, and each step narrows the next.
 *
 * The signals are the eighteen type colours, adapted to whichever ground was
 * chosen — they are mid-lightness by design, so offering only the ones that
 * already clear 4.5:1 left a light ground with two choices out of eighteen,
 * which is not a choice. The chip shows the adapted colour rather than the raw
 * one, so what you pick is still what you get.
 *
 * What is refused: a colour that would have to move so far to be readable that
 * it is no longer the colour on the chip (Electric yellow on white ends up
 * brown), and a second signal too close to the first to tell apart — those two
 * carry different meanings everywhere in this UI, so a pair that cannot be
 * distinguished is worse than a pair that is merely dull. Rejected chips stay
 * visible and greyed, because which colours a ground rules out is information
 * about the ground.
 *
 * The rule that greys a chip out is `signalRejection`, the same function the
 * build-time generator checks the shipped themes with.
 *
 * Text is not a choice. It is derived to clear both grounds, because it is the
 * one colour nobody can pick badly without the result being unusable.
 */
export function CustomThemeEditor({ onDone }: { onDone: () => void }) {
  const { custom, setCustom, setTheme } = useTheme();
  const [bg, setBg] = useState<string | null>(custom?.bg ?? null);
  const [accent, setAccent] = useState<string | null>(custom?.accent ?? null);
  const [accent2, setAccent2] = useState<string | null>(custom?.accent2 ? custom.accent2 : null);

  const choice: CustomChoice | null =
    bg && accent && accent2 ? { bg, accent, accent2 } : null;
  const preview = choice ? buildPalette(customBase(choice)) : null;

  /** Picking a new ground can invalidate signals chosen against the old one. */
  const pickGround = (hex: string) => {
    setBg(hex);
    if (accent && signalRejection(accent, hex)) setAccent(null);
    if (accent2 && signalRejection(accent2, hex, accent)) setAccent2(null);
  };

  const usable = (hex: string, other?: string | null) =>
    bg ? signalRejection(hex, bg, other) : 'choose a ground first';

  return (
    <div className="theme-custom">
      <ol className="theme-custom-steps">
        <li>
          <div className="hud-label">1 · Ground</div>
          <div className="theme-chips">
            {CUSTOM_GROUNDS.map((g) => (
              <button
                key={g.id}
                type="button"
                className={`theme-chip${bg === g.hex ? ' is-active' : ''}`}
                style={{ background: g.hex }}
                aria-pressed={bg === g.hex}
                aria-label={g.label}
                title={g.label}
                onClick={() => pickGround(g.hex)}
              />
            ))}
          </div>
        </li>

        <li>
          <div className="hud-label">
            2 · Signal
            {bg && (
              <span className="theme-custom-count">
                {CUSTOM_SIGNALS.filter((s) => !usable(s.hex)).length} of {CUSTOM_SIGNALS.length} readable here
              </span>
            )}
          </div>
          <div className="theme-chips">
            {CUSTOM_SIGNALS.map((s) => {
              const why = usable(s.hex);
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`theme-chip${bg && accent === adaptSignal(s.hex, bg).hex ? ' is-active' : ''}`}
                  // The chip shows the colour that will actually be used on
                  // this ground, which is not always the raw type colour.
                  style={{ background: bg ? adaptSignal(s.hex, bg).hex : s.hex }}
                  disabled={!!why}
                  aria-pressed={!!bg && accent === adaptSignal(s.hex, bg).hex}
                  aria-label={why ? `${s.label} — unavailable: ${why}` : s.label}
                  title={why ? `${s.label} — ${why}` : `${s.label} — ${contrast(adaptSignal(s.hex, bg!).hex, bg!).toFixed(1)}:1`}
                  onClick={() => {
                    const picked = adaptSignal(s.hex, bg!).hex;
                    setAccent(picked);
                    if (accent2 && signalRejection(accent2, bg!, picked)) setAccent2(null);
                  }}
                />
              );
            })}
          </div>
        </li>

        <li>
          <div className="hud-label">
            3 · Second signal
            {bg && accent && (
              <span className="theme-custom-count">
                {CUSTOM_SIGNALS.filter((s) => !usable(s.hex, accent)).length} still distinct
              </span>
            )}
          </div>
          <div className="theme-chips">
            {CUSTOM_SIGNALS.map((s) => {
              const why = usable(s.hex, accent);
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`theme-chip${bg && accent2 === adaptSignal(s.hex, bg).hex ? ' is-active' : ''}`}
                  style={{ background: bg ? adaptSignal(s.hex, bg).hex : s.hex }}
                  disabled={!!why}
                  aria-pressed={!!bg && accent2 === adaptSignal(s.hex, bg).hex}
                  aria-label={why ? `${s.label} — unavailable: ${why}` : s.label}
                  title={why ? `${s.label} — ${why}` : s.label}
                  onClick={() => setAccent2(adaptSignal(s.hex, bg!).hex)}
                />
              );
            })}
          </div>
        </li>
      </ol>

      {preview && choice && (
        <div className="theme-custom-preview">
          <span
            className="theme-swatch-face theme-custom-face"
            aria-hidden="true"
            style={{ background: preview.tokens['--color-bg'] }}
          >
            <span className="theme-swatch-accent" style={{ background: preview.tokens['--color-accent'] }} />
            <span className="theme-swatch-signal" style={{ background: preview.tokens['--color-accent-2'] }} />
          </span>
          <ul className="theme-custom-checks">
            {preview.checks.map((c) => (
              <li key={c.name} className={c.ok ? 'is-ok' : 'is-bad'}>
                <span>{c.name}</span>
                <span className="numeric">{c.ratio.toFixed(1)}:1</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="theme-custom-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!choice}
          onClick={() => {
            if (!choice) return;
            setCustom(choice);
            setTheme('custom');
            onDone();
          }}
        >
          {choice ? 'Use this theme' : 'Pick all three'}
        </button>
      </div>
    </div>
  );
}
