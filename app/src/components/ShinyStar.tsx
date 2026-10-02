import { useTheme } from '../state/ThemeContext';
import { ShinyBurst } from './ShinyBurst';

/**
 * The shiny preference as a bare star in the header. It carries no visible label (an accessible name only), and
 * when it turns on, from here or anywhere else, it throws a ring of sparkles once.
 */
export function ShinyStar() {
  const { shiny, toggleShiny } = useTheme();
  return (
    <span className={`shiny-star${shiny ? ' is-on' : ''}`}>
      <button type="button" role="switch" aria-checked={shiny} aria-label="Shiny sprites" className="shiny-star-btn" onClick={toggleShiny} />
      <ShinyBurst />
    </span>
  );
}
