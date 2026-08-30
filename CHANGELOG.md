# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add an option to keep the max-thinking rainbow border static without its repaint timer

## [0.1.2]

### Fixed

- Roll `formatNumber` over to the next unit at boundaries instead of emitting `1000K`/`1000M`

### Changed

- Reuse `hslToRgb`/`rgbToHex` from `rainbow.ts` in `getSessionAccentHex` instead of a duplicate `hslToHex`
- Name the menu row prefix widths (`PLAIN_ROW_PREFIX_LEN`, `CHECKBOX_ROW_PREFIX_LEN`) instead of repeating magic numbers
- Extract `emptyFeedData` for the repeated prototype-less feed map in `SegmentContextBuilder`
- Drop the redundant `leftParts`/`rightParts` copies in `buildStatusLine`

### Removed

- Remove the unused `block`/`space` status symbols and an unused test import

## [0.1.1]

### Changed

- Derive `SegmentIncludes` once in `resolveEffectiveSettings` instead of per-render
- Have `setSymbolPreset` return the previous preset so the settings preview restores the live preset correctly
- Measure `clampPathLength` budgets in display cells via `visibleWidth` to match layout.ts, with a grapheme-aware tail fallback that cannot split surrogate pairs
- Extract `shrinkPathSegment` from `buildStatusLine` and name its width constants
- Move `isBorderRow`/`stripRedundantStats` into `src/footer.ts` as tested pure functions
- Share box-row painting between the editor box and the settings preview via `src/box.ts`

### Removed

- Drop unused `StatusColor` roles, 16 icon keys, and `thinking.autoPending` left over from the oh-my-pi port

## [0.1.0]

Initial release

### Added

- Port oh-my-pi's powerline statusline as a pi extension with a box chrome, bar, and stats pill
- Render the box's bottom border from configurable segment groups
- Carry the stats and a context graph in the box's bottom border
- Add a live tok/s segment with pi-topping's hold-and-fade behavior
- Surface publisher feeds through configurable subscriptions
- Add text entry and dynamic rows to the menu component
- Add a border style setting sharing pi-topping's User Prompt glyphs
- Add a rainbow sweep around the box border at max thinking
- Add tests for context threshold bands and token rate events
- Run the test suite in CI with actions pinned to commit SHAs
- Document publishing a feed for extension authors

### Changed

- Replace the `/topping-status` command with a `/topping-statusline-settings` TUI
- Round the bar's outer edges with half-circle powerline caps
- Color the bar gap like the editor border, retiring the accent toggle
- Color the elevated context tier orange instead of purple
- Reorder the bottom segment groups around feeds
- Pad the token rate to a fixed width
- Relabel thinking mode and document the rainbow redraw cost
- Spell out the xhigh thinking label in the nerd and ascii sets
- Make the bar and stats pill transparent by default
- Cache repeated per-frame work and simplify segment plumbing
- Harden settings persistence and dedupe the settings menu
- Restore the footer trim under pi 0.84's dock layout
- Move source and tests into a `src` directory and the extension entry point to the repo root

### Fixed

- Elide middle path components in the bar's path segment
- Validate the PR URL and sanitize path and branch text
- Skip redundant color escapes and per-char border wrapping
- Fix inaccuracies in the README's settings and segment docs
- Remove the unused session color import

### Removed

- Drop the cost and context segments from the bar, now shown in the bottom border
- Drop the footer's cwd line, redundant with the bar
- Strip the footer stats down to what the bar doesn't show
