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

Each SVG is a **type-coloured disc with a white glyph on top** — full colour,
not a monochrome shape. So `components/TypeBadge.tsx` renders them as a plain
`<img>`: no mask, no tint, no filter. (An earlier pass assumed monochrome
glyphs and masked them to recolour; that would have flattened every icon into a
solid circle, since the disc covers the whole viewBox.)

A missing file just fails the image load and the badge renders text-only, so a
checkout without these assets still builds and runs. That's deliberate — they're
third-party and not committed by the build.

The badge tint in `src/styles/types.css` is taken from the disc fills in these
very files, so icon and badge can't drift apart. Re-extract after updating the
set:

```bash
grep -h 'fill:' public/type-icons/*.svg
```

Those colours sit outside the theme system on purpose: type colours are brand
constants and must not shift between themes. Only the badge *treatment* adapts
— tinted fill with coloured text on the dark ground, saturated fill with a
white label on the light one.
