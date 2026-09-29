import { fireEvent } from '@testing-library/react';
import { SCREEN_DEFS, sectionOf } from '../lib/screens';

/** Navigate as a person does: pick the section, then the screen in its rail. */
export function goTo(container: HTMLElement, label: string): void {
  const def = SCREEN_DEFS.find((d) => d.label === label)!;
  const rail = () => [...container.querySelectorAll('.nav-tab')].find((t) => t.textContent?.includes(label));
  if (!rail()) {
    const section = sectionOf(def.id);
    if (section) fireEvent.click(container.querySelector(`.nav-section[data-section="${section.id}"]`)!);
  }
  fireEvent.click(rail()!);
}
