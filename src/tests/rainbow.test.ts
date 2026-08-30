/**
 * Rainbow border: perimeter walk math, per-glyph colouring, the gap
 * geometry buildStatusLine hands the border callback, and the setting
 * default/plumbing.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SegmentContextBuilder } from "../context.ts";
import { buildStatusLine } from "../layout.ts";
import { perimeterLength, perimeterPosition, RainbowBorder } from "../rainbow.ts";
import { resolveEffectiveSettings } from "../settings.ts";
import { theme } from "../theme.ts";

const fakePi = { exec: async () => undefined, getThinkingLevel: () => "off" } as unknown as ExtensionAPI;
const fakeCtx = {
	cwd: "/tmp/pi-topping-statusline-tests",
	sessionManager: { getEntries: () => [], getSessionName: () => undefined },
	getContextUsage: () => undefined,
	model: undefined,
} as unknown as ExtensionContext;

const builder = new SegmentContextBuilder(fakePi);
builder.attach(fakeCtx);
const BASE = builder.build(
	80,
	resolveEffectiveSettings({}).segmentOptions,
	{ git: false, pr: false, piStats: false, tokenRate: false, feeds: [] },
	undefined,
);

/** Border cells in clockwise walk order, starting at the top-left corner. */
function walkPositions(width: number, bottomIdx: number): number[] {
	const positions: number[] = [];
	for (let col = 0; col < width; col++) positions.push(perimeterPosition(0, col, width, bottomIdx));
	for (let row = 1; row < bottomIdx; row++) positions.push(perimeterPosition(row, width - 1, width, bottomIdx));
	for (let col = width - 1; col >= 0; col--) positions.push(perimeterPosition(bottomIdx, col, width, bottomIdx));
	for (let row = bottomIdx - 1; row >= 1; row--) positions.push(perimeterPosition(row, 0, width, bottomIdx));
	return positions;
}

test("the perimeter walk covers every border cell exactly once, in order", () => {
	for (const [width, bottomIdx] of [
		[10, 5],
		[12, 2],
		[5, 5],
	] as const) {
		const P = perimeterLength(width, bottomIdx);
		const positions = walkPositions(width, bottomIdx);
		assert.equal(positions.length, P, `expected ${P} border cells`);
		assert.equal(new Set(positions).size, P, "walk visits a position twice");
		for (const [i, p] of positions.entries()) {
			const prev = positions[(i - 1 + P) % P]!;
			assert.equal((p - prev + P) % P, 1, `step ${i} is not consecutive with its neighbour`);
		}
	}
});

test("colorChar wraps the glyph in per-char ANSI and resets", () => {
	const rainbow = new RainbowBorder(0);
	assert.match(rainbow.colorChar("─", 0, 28), /^\x1b\[38;(2;\d+;\d+;\d+|5;\d+)m─\x1b\[39m$/);
});

test("far-apart perimeter positions get different hues", () => {
	const rainbow = new RainbowBorder(0);
	// Opposite sides of a 28-cell perimeter are 180° of hue apart.
	assert.notEqual(rainbow.colorChar("─", 0, 28), rainbow.colorChar("─", 14, 28));
});

test("step wraps the phase modulo 360", () => {
	const a = new RainbowBorder(0);
	const b = new RainbowBorder(0);
	a.step(361);
	b.step(1);
	assert.equal(a.colorChar("─", 0, 28), b.colorChar("─", 0, 28));
});

test("the gap callback receives the absolute gap column and row", () => {
	const calls: Array<{ str: string; startCol: number; row: number }> = [];
	buildStatusLine(
		80,
		BASE,
		resolveEffectiveSettings({}),
		(str, startCol, row) => {
			calls.push({ str, startCol, row });
			return str;
		},
		{ left: [], right: ["pi"] },
		{ col: 3, row: 7 },
	);
	assert.equal(calls.length, 1);
	const call = calls[0]!;
	assert.equal(call.row, 7);
	// No left group: the gap starts at the bar origin.
	assert.equal(call.startCol, 3);
	assert.ok(call.str.includes(theme.getBox("rounded").horizontal));
});

test("a left group shifts the gap start by its width", () => {
	const calls: Array<{ startCol: number }> = [];
	buildStatusLine(
		80,
		BASE,
		resolveEffectiveSettings({}),
		(str, startCol) => {
			calls.push({ startCol });
			return str;
		},
		{ left: ["pi"], right: [] },
		{ col: 3, row: 0 },
	);
	assert.equal(calls.length, 1);
	assert.ok(calls[0]!.startCol > 3, "gap starts after the pi segment, not at the origin");
});

test("rainbow settings default to true and resolve explicit false", () => {
	assert.equal(resolveEffectiveSettings({}).rainbowBorder, true);
	assert.equal(resolveEffectiveSettings({}).rainbowAnimation, true);
	assert.equal(resolveEffectiveSettings({ rainbowBorder: false }).rainbowBorder, false);
	assert.equal(resolveEffectiveSettings({ rainbowAnimation: false }).rainbowAnimation, false);
});

test("borderStyle defaults to rounded and is loadable", () => {
	assert.equal(resolveEffectiveSettings({}).borderStyle, "rounded");
	assert.equal(resolveEffectiveSettings({ borderStyle: "heavy" }).borderStyle, "heavy");
});

test("getBox falls back to the ascii box regardless of style under the ascii preset", () => {
	theme.setSymbolPreset("ascii");
	try {
		assert.equal(theme.getBox("heavy").topLeft, "+");
	} finally {
		theme.setSymbolPreset("nerd");
	}
});
