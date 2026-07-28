/**
 * Normal / Shadow selector.
 *
 * Deliberately not a SegGroup: "Shadow" is a property of the Pokémon, not a
 * view option, so it gets its own visual language rather than the accent used
 * for selected controls. The violet corona on the sprite carries the read; the
 * button just echoes the same hue.
 */
export function FormToggle({
  shadow,
  eligible,
  onChange,
  speciesName,
}: {
  shadow: boolean;
  eligible: boolean;
  onChange: (shadow: boolean) => void;
  speciesName: string;
}) {
  return (
    <div className="form-toggle" role="group" aria-label="Form">
      <button
        type="button"
        className={`form-opt form-opt-normal${!shadow ? ' is-active' : ''}`}
        aria-pressed={!shadow}
        onClick={() => onChange(false)}
      >
        Normal
      </button>
      <button
        type="button"
        className={`form-opt form-opt-shadow${shadow ? ' is-active' : ''}`}
        aria-pressed={shadow}
        disabled={!eligible}
        onClick={() => onChange(true)}
        title={eligible ? 'Attack x1.2, defense x5/6' : `${speciesName} has no Shadow form`}
      >
        Shadow
      </button>
    </div>
  );
}
