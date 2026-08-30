/**
 * Geometry contracts for the shared box chrome: every bar row must total
 * exactly boxWidth cells with the 3/2/+2 layout (corner, 2-cell run, bar,
 * pad+2 run, corner), and the non-rainbow painters must wrap whole runs in a
 * single flat call rather than per glyph — index.ts relies on that fast path
 * to keep per-frame ANSI output small.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { makeBoxPainters, renderBoxRow, renderBoxRowIfVisible } from "../box.ts";
import { RainbowBorder } from "../rainbow.ts";
import type { BoxGlyphs } from "../theme.ts";

const ROUNDED: BoxGlyphs = {
	topLeft: "╭",
	topRight: "╮",
	bottomLeft: "╰",
	bottomRight: "╯",
	horizontal: "─",
	vertical: "│",
};

const identityPainters = (boxWidth: number) =>
	makeBoxPainters({
		rainbowOn: false,
		rainbow: new RainbowBorder(0),
		box: ROUNDED,
		width: boxWidth,
		bottomIdx: 2,
		flat: s => s,
	});

test("a bar row is corner + 2 run + bar + pad+2 run + corner", () => {
	const out = renderBoxRow(identityPainters(20), "X", 0, 20, ROUNDED.topLeft, ROUNDED.topRight);
	assert.equal(out, "╭──X" + "─".repeat(15) + "╮");
	assert.equal(visibleWidth(out), 20);
});

test("an empty bar renders chrome only, still totalling boxWidth", () => {
	const out = renderBoxRow(identityPainters(20), "", 2, 20, ROUNDED.bottomLeft, ROUNDED.bottomRight);
	assert.equal(out, "╰──" + "─".repeat(16) + "╯");
	assert.equal(visibleWidth(out), 20);
});

test("an empty footer bar reserves no row", () => {
	assert.deepEqual(
		renderBoxRowIfVisible(identityPainters(20), "\x1b[32m \x1b[0m", 2, 20, ROUNDED.bottomLeft, ROUNDED.bottomRight),
		[],
	);
});

test("a visible footer bar retains one row", () => {
	const rows = renderBoxRowIfVisible(identityPainters(20), "X", 2, 20, ROUNDED.bottomLeft, ROUNDED.bottomRight);
	assert.equal(rows.length, 1);
	assert.equal(rows[0], "╰──X" + "─".repeat(15) + "╯");
});

test("wide characters in the bar consume pad cells, keeping the total fixed", () => {
	const out = renderBoxRow(identityPainters(20), "日本", 0, 20, ROUNDED.topLeft, ROUNDED.topRight);
	assert.equal(out, "╭──日本" + "─".repeat(12) + "╮");
	assert.equal(visibleWidth(out), 20);
});

test("a bar wider than the budget clamps pad to zero", () => {
	const bar = "x".repeat(15);
	const out = renderBoxRow(identityPainters(20), bar, 0, 20, ROUNDED.topLeft, ROUNDED.topRight);
	assert.equal(out, `╭──${bar}──╮`);
});

test("non-rainbow painters wrap whole runs in one flat call", () => {
	const painters = makeBoxPainters({
		rainbowOn: false,
		rainbow: new RainbowBorder(0),
		box: ROUNDED,
		width: 20,
		bottomIdx: 2,
		flat: s => `[${s}]`,
	});
	assert.equal(painters.horizRun(0, 1, 3), "[───]");
	assert.equal(painters.gapColor("──", 5, 0), "[──]");
	assert.equal(painters.paint(0, 0, ROUNDED.topLeft), "[╭]");
});

test("rainbow coloring never changes the geometry", () => {
	const painters = makeBoxPainters({
		rainbowOn: true,
		rainbow: new RainbowBorder(0),
		box: ROUNDED,
		width: 20,
		bottomIdx: 2,
		flat: s => s,
	});
	const out = renderBoxRow(painters, "X", 0, 20, ROUNDED.topLeft, ROUNDED.topRight);
	assert.equal(stripVTControlCharacters(out), "╭──X" + "─".repeat(15) + "╮");
});
