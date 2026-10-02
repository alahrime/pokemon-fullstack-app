import { THEMES, useTheme } from '../state/ThemeContext';
import { SegButton, SegGroup } from './Seg';

/** Theme picker, sized to sit inline in the nav. */
export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();

  return (
    <SegGroup>
      {THEMES.map((t) => (
        <SegButton key={t.id} active={theme === t.id} onClick={() => setTheme(t.id)} title={t.blurb}>
          {t.label}
        </SegButton>
      ))}
    </SegGroup>
  );
}

/**
 * Motion kill switch.
 *
 * Lives next to the heatmap rather than in the nav — the heatmap's 256-cell
 * reveal and the 3D auto-orbit are far and away the most motion in the app, so
 * that's where someone reaches for the switch. The setting itself is still
 * global and persisted; turning it off here also stills the battle timeline.
 */
export function MotionToggle({ className }: { className?: string }) {
  const { motion, toggleMotion } = useTheme();
  return (
    <button
      className={`btn chip-btn${className ? ' ' + className : ''}`}
      onClick={toggleMotion}
      aria-pressed={motion === 'off'}
      title={motion === 'on' ? 'Disable animation (applies app-wide)' : 'Enable animation (applies app-wide)'}
    >
      {motion === 'on' ? 'Motion on' : 'Motion off'}
    </button>
  );
}
