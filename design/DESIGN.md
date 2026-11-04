# Bureau — design record

**Surface mode:** Operate (an app the user works in). Ambition shows through precision; brand lives in a few exact details.

**Brief (pinned by the owner):** cream as the main colour; palette and kit of a Renaissance master assassin (cream robe, crimson sash, leather, brass, steel).

The source of truth is `web/src/styles/tokens.css`. Change a colour or a size there and the whole app follows. Fonts are declared in `web/src/styles/fonts.css`.

`design/design-book.html` is the visual record: one self-contained file, with every specimen drawn by the shipped tokens and classes, by day and by night. It is generated, so after a token or style change run `node design/build-book.mjs`, and edit its page text in `design/design-book.src.html`.

## Tokens

| Name | Light | Night | Role |
|---|---|---|---|
| Parchment (`--bg`) | `#F3ECDF` | `#17110E` | Page ground |
| Linen (`--surface`) | `#FEFBF6` | `#221A15` | Sheets: lists, panels, inputs |
| Vellum (`--well`) | `#E9E0CF` | `#30261F` | Wells, tracks, tab groups |
| Leather rail (`--rail`) | `#2B1D15` | `#0F0A08` | Sidebar and phone top bar, dark in both themes |
| Ink (`--text`) | `#1E1611` | `#F3EADC` | Text and icons |
| Ink 2 (`--text-2`) | `#54453A` | `#CDBCA6` | Secondary text |
| Ink 3 (`--text-3`) | `#6E5E50` | `#A99887` | Quiet text; still AA on every surface |
| Sash (`--accent`) | `#8C1A1F` | `#EC8173` | Links, current selection, the hunt |
| Sash fill (`--accent-fill`) | `#8C1A1F` | `#AD2D2C` | Primary buttons, count badges, switches |
| Brass (`--focus`) | `#8A6514` | `#DCB763` | Focus rings only |
| Warning (`--warn`) | `#6B4E0C` | `#E0BD6C` | "Needs attention" text |
| Leather (`--leather`) | `#5A3A27` | `#BB9270` | Data marks (bars, grade C) |
| Olive (`--good`) | `#3F5226` | `#B4C78A` | Success / verified |

Inside the rail and on the live sash the semantic tokens are redefined locally, so any component placed there is readable without its own rule.

**Type:** Newsreader 500 for page titles, the hunt status line, dialog and drawer titles, empty-state headings and the letters themselves (they are documents); its optical sizes hold up from 18 px to 48 px. Hanken Grotesk for everything else, including every number (tabular). IBM Plex Mono only for code and the raw scan log. All self-hosted. Scale in rem: 0.8125 · 0.875 · 0.9375 · 1.0625 · 1.4375 · 2.5 · 3 (body is 1 rem on phones, so iOS never zooms a field).

**Space:** 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 px.

**Radii:** tag 5, control 8, sheet 14, the band and dialogs 18, chips and counts round. Smaller things have smaller corners.

**Elevation:** `--e-1` a sheet resting on the desk (a hairline and a whisper of shadow), `--e-2` something lifted under the pointer, `--e-3` overlays. A sheet inside a sheet gets a tone step, never a second shadow.

**Layout:** A worktable. A leather rail on the left, parchment ground, linen sheets. Left-aligned throughout. Lists are real tables or row lists with a single hairline between rows.

**Phone and tablet:** At 820 px and below the rail gives way to a leather top bar and a five-tab bar, with safe-area insets on every edge. Every touch target is at least 44 px: controls are that tall, and small ones (`.btn.sm`, chips, removable tags, switches, ticks, links in a meta line) keep their look and grow an invisible hit area, so dense rows stay dense. The same sizes apply to any coarse pointer on a wider screen. Tab strips stay on one line and slide, and wide tables slide inside their sheet; in both, a soft edge shadow says there is more. From 621 to 820 px fields stay in two columns and the wizard's steps stay in view. At 620 px and below, dialogs rise as bottom sheets and a label with a select stacks. At 360 px and below the margins tighten from 16 to 12 px.

## Principles

1. **One bold element.** When the hunt is on, a crimson sash runs across the top of the Overview, with a darker fold crossing it. Nothing else gets that colour at that scale.
2. **One signature in the shell.** By day the current page is a tab cut from the leather rail into the page itself; by night it is a strip of the sash.
3. **Data in sans.** Numbers are Hanken Grotesk tabular; the serif never labels or measures.
4. **Status by tone and words.** Selected rows change tone and tags always carry a word; nothing gets a coloured side border, glow or halo, and colour never carries meaning alone.
5. **No ornament.** No eyebrows, no styled accent words, no dividers-as-decoration, no unicode icons, no sparklines or rings standing in for content.
6. **Motion conveys state.** 140–220 ms transitions, none of them required to read the page. The one authored moment is the sash drawing across when the hunt is switched on. Reduced-motion settings are respected.
7. **Plain words.** Controls name their action; empty states say what to do next.
8. **AA everywhere.** Text is at least 4.5:1 and focus rings at least 3:1 in both themes, inside the rail and on the sash. Keep it that way when a token changes.
9. **A thumb is not a pointer.** 44 px targets, nothing that relies on hover, and a visible answer on press.
