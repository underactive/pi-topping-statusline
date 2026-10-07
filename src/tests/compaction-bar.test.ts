import assert from "node:assert/strict";
import test from "node:test";
import { resetCapabilitiesCache, setCapabilities, setCapabilityOverrides } from "@earendil-works/pi-tui";
import { renderCompactionBar } from "../compaction-bar.ts";

const MODE = { mode: "truecolor" as const };
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (text: string) => text.replace(ANSI_RE, "");

function filledColors(bar: string): Array<[number, number, number]> {
	const colors: Array<[number, number, number]> = [];
	for (const match of bar.matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+)m▋/g)) {
		colors.push([Number(match[1]), Number(match[2]), Number(match[3])]);
	}
	return colors;
}

function brightestCell(colors: Array<[number, number, number]>): number {
	let brightest = 0;
	for (let i = 1; i < colors.length; i++) {
		if ((colors[i]?.[1] ?? 0) > (colors[brightest]?.[1] ?? 0)) brightest = i;
	}
	return brightest;
}

test("bar has the expected glyphs, green trough, and foreground-only resets", () => {
	const bar = renderCompactionBar(50, MODE);
	assert.equal(stripAnsi(bar), `${"▋".repeat(10)}${"░".repeat(10)}`);
	assert.match(bar, /\x1b\[38;2;38;100;70m/);
	assert.match(bar, /\x1b\[2m/);
	assert.doesNotMatch(bar, /\x1b\[0m/);
});

test("the phosphor comet moves from right to left", () => {
	const right = filledColors(renderCompactionBar(100, { ...MODE, shimmerElapsedMs: 500 }));
	const left = filledColors(renderCompactionBar(100, { ...MODE, shimmerElapsedMs: 1_500 }));
	assert.equal(right.length, 20);
	assert.equal(left.length, 20);
	assert.notDeepEqual(right, left);
	assert.ok(brightestCell(right) > brightestCell(left));
});

test("bar supports 256-color escapes", () => {
	const bar = renderCompactionBar(100, { mode: "256color", shimmerElapsedMs: 500 });
	assert.match(bar, /\x1b\[38;5;\d+m/);
	assert.doesNotMatch(bar, /\x1b\[38;2;/);
	assert.doesNotMatch(bar, /\x1b\[0m/);
});

test("bar clamps NaN and out-of-range percentages", () => {
	const empty = renderCompactionBar(0, MODE);
	const full = renderCompactionBar(100, MODE);
	assert.equal(renderCompactionBar(Number.NaN, MODE), empty);
	assert.equal(renderCompactionBar(-10, MODE), empty);
	assert.equal(renderCompactionBar(150, MODE), full);
});

test("default bar color follows terminal capability detection", () => {
	try {
		setCapabilities({ images: null, trueColor: true, hyperlinks: false });
		resetCapabilitiesCache();
		assert.match(renderCompactionBar(50), /\x1b\[38;2;/);
	} finally {
		setCapabilityOverrides({});
		resetCapabilitiesCache();
	}
});
