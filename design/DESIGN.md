# Bureau — design record

**Surface mode:** Operate (an app the user works in). Ambition shows through precision; brand lives in a few exact details.

**Brief (pinned by the owner):** cream as the main colour; palette and kit of a Renaissance master assassin (cream robe, crimson sash, leather, brass, steel).

## Tokens

| Name | Hex | Role |
|---|---|---|
| Parchment | `#F2EADB` | Page ground |
| Vellum | `#E7DCC7` | Second neutral: sidebar, toolbars, wells |
| Linen | `#FBF8F1` | Working surfaces: lists, panels, inputs |
| Ink | `#211A15` | Text and icons |
| Sash | `#8E1B1B` | The only accent: primary actions, current selection, the hunt |
| Brass | `#A8842F` | Focus rings and "needs attention" only |
| Leather | `#5C3B26` | Data marks (bars, grade C) |
| Olive | `#4F5F33` | Success / verified |

**Type:** Cormorant Garamond 600 for page titles, the hunt status line and the letters themselves (they are documents). IBM Plex Sans for everything else, including every number (tabular). IBM Plex Mono only for the raw scan log. Fixed rem scale, ratio ~1.2: 0.8125 · 0.875 · 1 · 1.125 · 1.375 · 2.25.

**Layout:** A worktable. A vellum rail on the left, parchment ground, linen panels separated by tone, not outlines. Left-aligned throughout. Lists are real tables or row lists with a single hairline between rows.

## Principles

1. **One bold element.** When the hunt is on, a crimson sash runs across the top of the Overview. Nothing else gets that colour at that scale.
2. **Data in sans.** Numbers are Plex Sans tabular; the serif never labels or measures.
3. **Status by tone, not by boxes.** Selected rows darken; nothing gets a coloured side border, glow or halo.
4. **No ornament.** No eyebrows, no styled accent words, no dividers-as-decoration, no unicode icons, no sparklines or rings standing in for content.
5. **Motion conveys state.** 150–250 ms transitions. The one authored moment is the sash drawing across when the hunt is switched on.
6. **Plain words.** Controls name their action; empty states say what to do next.
