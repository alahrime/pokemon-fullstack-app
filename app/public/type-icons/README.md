# Type icons

Vendored from [partywhale/pokemon-type-icons](https://github.com/partywhale/pokemon-type-icons)
— SVG recreations of the type icons from Brilliant Diamond / Shining Pearl,
Legends: Arceus, and Scarlet / Violet. **MIT licensed**; `LICENSE` should sit
alongside the SVGs in this directory.

## Fetching them

```bash
cd <repo root>
git clone --depth 1 https://github.com/partywhale/pokemon-type-icons.git /tmp/pti
mkdir -p app/public/type-icons
cp /tmp/pti/icons/*.svg app/public/type-icons/
cp /tmp/pti/LICENSE app/public/type-icons/LICENSE
rm -rf /tmp/pti
```

Expected result: 18 files, `bug.svg` … `water.svg`, named for the lowercase
type, matching the `type` strings in `species.json`.

## How they're used

`components/TypeBadge.tsx` renders each glyph as a **CSS mask** over a solid
`currentColor` background, not as an `<img>`. The icons are flat monochrome and
have to take 18 different colours; a `filter` chain can't reach an arbitrary hue
from black with any accuracy, whereas a mask gives the exact colour for free and
inherits the badge's text colour in both themes.

Because a mask has no load event, availability is probed once with a single
`Image()` and shared across every badge. If the directory is empty the probe
fails and badges render as text only — the app still builds and runs, it just
looks plainer. That is deliberate: these are third-party assets that a fresh
checkout may not have.

Colours live in `src/styles/types.css` and are intentionally outside the theme
system: type colours are brand constants and must not shift between themes.
