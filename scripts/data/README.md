# Measuring thread colour

Every hex in `src/lib/dmc-pearl-cotton.ts` was eyeballed off a screen. So was
every public DMC dataset — DMC has never published RGB for any thread line, and
the two best public tables (Wolfram n=454, camelia n=455) disagree with *each
other* by a median 4.05 dE2000, the same size as their disagreement with ours.
Swapping to one of them is churn. Holding a skein under a camera next to a
reference chart is the only thing that settles it, and it is a bounded job: we
own 77 of the 480 colours.

Three files, in order:

| File | What it is |
|------|-----------|
| `measurement-scope.json` | the 77 to shoot, in winding order. Regenerate with `scripts/build-measurement-scope.ts` |
| `thread-measurements.csv` | one row per sample, filled in by hand from the developed shots |
| `scripts/import-thread-measurements.ts` | CSV → `src/lib/dmc-measured.ts`, which every hex consumer already reads |

## Winding the cards

Wind each thread as a **tight single-layer band about 20mm wide** across a
neutral grey card. Tight and single-layer is the whole measurement: a gap that
shows card through the band mixes the card's grey into the reading, and a double
layer casts shadows between the passes. Lay 12–16 cards per sheet with the
ColorChecker **in the same frame** — not a separate calibration shot, because
the point of the chart is to carry the exact light of *this* frame.

Shoot the colours in the order `measurement-scope.json` lists them (most designs
first, then most stock). The list is sorted so that a half-finished job is still
the half that matters.

## The shot

- Two daylight LED panels at 45 degrees either side. Room lights **off**, no
  window — a second light source with a different spectrum cannot be corrected
  out afterwards.
- Tripod, full manual, **fixed** white balance, f/8, lowest native ISO, RAW.
  Auto anything makes two frames of the same card differ by more than the
  colours you are trying to tell apart.
- Expose so the chart's white patch sits around 90% and is **not clipped**. A
  clipped white patch gives the calibration nothing to anchor to.
- Develop to **16-bit linear TIFF**, neutral profile, **no tone curve**. A tone
  curve is a nonlinear change to exactly the numbers being measured.

## Two passes: polarised and not

Pearl cotton is mercerized, so it is glossy, and the sheen is a real part of
what a skein looks like in the hand. Shoot **every sheet twice**: once with
crossed polarisers (filter on each light, filter on the lens, crossed), once
without.

The polarised pass kills the specular highlight and is far more repeatable —
it is what keeps the spread down. It also reads **darker and more saturated**
than the thread looks on a table, because the sheen it removes is light the eye
really does see.

**Which pass becomes the hex is a judgement, made against a real skein under
normal light — do not bake it in blind.** Import one pass, look at the palette
beside the physical thread, and decide. Record the choice in the `geometry`
column (`polarised` / `unpolarised`) so a later run can tell which is which.

## Filling in the CSV

One row per **sample**, not per colour. Shoot each colour at least three times
— different cards where possible, different frames at minimum — because the
importer takes the **median** across samples and reports the **spread** (max
CIEDE2000 between samples of one colour). A single sample gives a spread of 0,
which tells you nothing.

L/a/b are CIELAB, **D65/2deg**. The importer refuses anything else rather than
quietly treating a D50 reading as D65, which would bake in a 2–4 dE error that
nothing downstream can see.

## Importing

```
npx tsx --tsconfig tsconfig.json scripts/import-thread-measurements.ts --dry
npx tsx --tsconfig tsconfig.json scripts/import-thread-measurements.ts
```

It warns loudly on a spread above 2.5 dE2000 (about two rungs of a DMC shade
ladder — that set cannot tell its own colours apart, so reshoot), and prints the
dE2000 between each new value and the hand-written one, worst first. That list
is the answer to "how wrong were we?".

It refuses to write the whole file — nothing half-imported — when:

| Refusal | Why |
|---------|-----|
| a `dmcNumber` is not in the palette | "3706" mistyped as "3760" is also a real colour and would repaint one nobody measured |
| `L` outside 0–101 | past 101 is arithmetic, not thread |
| `a` or `b` outside ±128 | the signed channels are where a decimal point or a minus sign goes missing. `a*-383.20` for `a*-38.32` is finite, agrees with every sample typed from the same bad reading, and goes straight into colour matching |
| `measuredAt` is not a real date | it is parsed, not just shape-matched: `2026-13-45` passes the shape, and since the recorded date is the latest one in the set, a bad date sorts last and *becomes* the recorded date |
| not D65/2deg | storing a D50 reading as D65 bakes in a 2–4 dE error nothing downstream can see |
| a reading is over 20 dE2000 from the literal it replaces | likelier a typo than a correction: the biggest hand correction ever justified against a real skein was 33 Fuchsia at 11.63, while a dropped decimal lands near 35 and a lost minus sign near 54. Pass `--allow-drift` if the skein really is that far out |

`L` **between 100 and 101 is a warning, not a refusal**. Optically brightened
whites fluoresce under a D65 source carrying UV and genuinely read a little over
100; B5200 and BLANC are both in scope and both do it. One L\*100.4 white used to
throw away every other colour in the batch.

## Colours outside sRGB

A reading that lands outside the sRGB gamut is **expected**, not an error — real
saturated dye leaves the gamut easily. 995 Electric Blue gets there with only
about 5.6 b\* units more chroma than the eyeballed value it replaces.

The importer keeps `lab` exact and clamps only `hex`, and prints a `NOTE` saying
so. That is the right way round: `lab` is what `findNearestDmcColor` and the
photo quantizer in `color-utils.ts` read, and `hex` exists for the screen, which
cannot show the colour anyway.

`src/lib/dmc-palette-checks.ts` states the same rule and exempts those entries
from its two hex-shaped assertions (no thread at pure black or white;
lab-agrees-with-its-hex), because a clamped hex cannot convert back to its own
lab and a white read at L\*99.95 really is `#FFFFFF`. They are covered instead by
an exact check that a measured entry carries the hex its own lab converts to,
clamp included — which still catches an import pairing a lab with the wrong hex.
If the suite reddened on the first real measurement session over something the
operator cannot act on, it would be switched off within the week.

The generated file is written whole from the CSV each time, so the CSV is the
record and `dmc-measured.ts` is disposable output: the same CSV always produces
a byte-identical file, and running the importer over a CSV with no data rows
restores the empty file, which is how you back an import out.

## Regenerating the scope

```
set -a && . ./.env.local && set +a
npx tsx --tsconfig tsconfig.json scripts/build-measurement-scope.ts
```

Read-only. `currentHex` is the hex **literal** parsed out of
`dmc-pearl-cotton.ts`, not `DMC_PEARL_COTTON[].hex` — `createColor` already
substitutes `MEASURED`, so reading the palette would make each measured colour
claim its reading replaces itself. The reading already on file is a separate
`measuredHex` field, null for a card still to shoot.

A colour is in scope if a live 18ct design calls for it, or there are
skeins of it on the shelf, or a bobbin of it is already wound. 13ct is excluded:
those intro kits arrive finished from the supplier, so we never hold their
thread (`src/lib/sourcing.ts`).
