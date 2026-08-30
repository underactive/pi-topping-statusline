/**
 * These helpers regex-parse rows the HOST renders (the editor's border rows
 * and the default footer's stats line), so the fixtures mirror real pi output:
 * border rows are ─ (U+2500) runs, the scroll hint is "↑/↓ N more", stats
 * parts are single-space separated with the model side right-aligned behind a
 * 2+ space gap, and the context chunk looks like "22.8%/1.0M (auto)".
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
	collapseFooterLayoutSlot,
	filterVisibleRows,
	isBorderRow,
	stripAnsi,
	stripRedundantStats,
} from "../footer.ts";

test("isBorderRow accepts a plain border run", () => {
	assert.equal(isBorderRow("─────"), true);
});

test("isBorderRow accepts a scroll-hint row with a trailing run", () => {
	assert.equal(isBorderRow("─── ↑ 3 more ───"), true);
});

test("isBorderRow accepts a scroll-hint row without a trailing run", () => {
	assert.equal(isBorderRow("── ↓ 12 more"), true);
});

test("isBorderRow sees through ANSI color codes", () => {
	assert.equal(isBorderRow("\x1b[38;5;244m────\x1b[0m"), true);
});

test("isBorderRow rejects text rows, empty rows, and ASCII dashes", () => {
	assert.equal(isBorderRow("│ hello │"), false);
	assert.equal(isBorderRow(""), false);
	assert.equal(isBorderRow("--- ascii ---"), false);
});

test("stripAnsi removes SGR sequences only", () => {
	assert.equal(stripAnsi("\x1b[32mgreen\x1b[0m plain"), "green plain");
});

test("filterVisibleRows drops empty notifications but keeps visible rows", () => {
	assert.deepEqual(filterVisibleRows(["", "  ", "\x1b[32m\x1b[0m", "saved $1.23"]), ["saved $1.23"]);
});

test("fullscreen footer slot can collapse and restores its minimum", () => {
	const footer = { render: () => [] };
	const footerContainer = { children: [footer] };
	const footerEntry = { component: footerContainer, minSize: 1 };
	const dock = { entries: [{ component: {} }, footerEntry] };
	const root = { entries: [{ component: {} }, { component: dock, minSize: 1 }] };

	const restore = collapseFooterLayoutSlot(root, footer);
	assert.equal(footerEntry.minSize, 0);
	assert.equal(root.entries[1]?.minSize, 1, "must not collapse the whole dock");
	restore?.();
	assert.equal(footerEntry.minSize, 1);
});

test("inline layouts without a footer slot are left untouched", () => {
	assert.equal(collapseFooterLayoutSlot(undefined, {}), undefined);
	assert.equal(collapseFooterLayoutSlot({ children: [] }, {}), undefined);
});

test("stripRedundantStats passes undefined through", () => {
	assert.equal(stripRedundantStats(undefined), undefined);
});

test("stripRedundantStats drops the context chunk but keeps unique stats", () => {
	// "92.3%" must not false-match the chunk regex (no slash follows it).
	assert.equal(
		stripRedundantStats("↑ 12.4K ↓ 3.1K R 148K W 12K 92.3% $0.42 22.8%/1.0M (auto)"),
		"↑ 12.4K ↓ 3.1K R 148K W 12K 92.3% $0.42",
	);
});

test("stripRedundantStats drops the right-aligned model side", () => {
	assert.equal(stripRedundantStats("↑ 1K ↓ 2K   (anthropic) claude-opus • max"), "↑ 1K ↓ 2K");
});

test("stripRedundantStats collapses to undefined when only redundant parts remain", () => {
	assert.equal(stripRedundantStats("?/200K  (openai) gpt"), undefined);
	assert.equal(stripRedundantStats("22.8%/1.0M (auto)  model"), undefined);
});

test("stripRedundantStats leaves a line of unique stats untouched", () => {
	assert.equal(stripRedundantStats("↑ 1K ↓ 2K R 5K W 1K $0.10"), "↑ 1K ↓ 2K R 5K W 1K $0.10");
});

test("stripRedundantStats strips ANSI before parsing", () => {
	assert.equal(stripRedundantStats("\x1b[32m↑ 1K\x1b[0m ↓ 2K"), "↑ 1K ↓ 2K");
});
