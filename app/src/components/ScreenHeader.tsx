import type { ReactNode } from 'react';

/**
 * The title block every screen opens with.
 *
 * Before this, screens began abruptly on their first control — you could not
 * tell the Rankings screen from the Cores screen without reading the widgets.
 * A page that states what it is costs three lines and is the difference
 * between a tool and a collection of panels.
 *
 * `aside` takes the screen-level actions (exports, mostly) so they land on the
 * same baseline as the title everywhere rather than wherever each screen had
 * happened to put them.
 */
export function ScreenHeader({
  title,
  blurb,
  aside,
}: {
  title: string;
  blurb?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-(--rule-strong) pb-4">
      <div className="min-w-0 flex-1 basis-80">
        <h1 className="font-(family-name:--font-head) text-3xl/none tracking-tight">
          {/* The accent bar reads as a cursor: this is where the page begins. */}
          <span className="mr-3 inline-block h-[0.7em] w-1 translate-y-[0.04em] bg-(--color-accent) align-middle" aria-hidden="true" />
          {title}
        </h1>
        {blurb && (
          <p className="mt-2 max-w-[70ch] text-sm/relaxed text-(--text-muted)">{blurb}</p>
        )}
      </div>
      {aside && <div className="flex flex-wrap items-center gap-2">{aside}</div>}
    </header>
  );
}
