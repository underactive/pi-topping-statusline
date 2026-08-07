/**
 * clampPathLength budgets display cells (visibleWidth), matching the cell
 * budgets layout.ts compares its output against. ASCII behavior is unchanged
 * from the .length-based implementation; CJK/emoji paths are where the two
 * measures diverge (a CJK char is 1 UTF-16 unit but 2 cells).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { clampPathLength } from "../utils.ts";

test("returns the path unchanged when it fits the budget", () => {
	assert.equal(clampPathLength("~/a/b", 20), "~/a/b");
});

test("elides middle components, keeping the first folder and basename", () => {
	assert.equal(clampPathLength("~/projects/pi/topping/src", 20), "~/projects/…/src");
});

test("drops middle components farthest from the cwd first", () => {
	assert.equal(clampPathLength("~/a/bb/cc/dd", 11), "~/a/…/cc/dd");
});

test("drops the first folder once even one middle component overflows", () => {
	assert.equal(clampPathLength("~/aaaa/bb/cc", 8), "…/bb/cc");
});

test("falls back to tail truncation on a long basename", () => {
	const result = clampPathLength("~/x/averylongbasename", 10);
	assert.equal(result, "…gbasename");
	assert.ok(visibleWidth(result) <= 10);
});

test("CJK components are measured in cells, not UTF-16 units", () => {
	const pwd = "~/文档/项目/源代码";
	// The .length-based implementation would have returned this un-clamped:
	// 11 UTF-16 units fit a budget of 12, but the path spans 18 cells.
	assert.ok(pwd.length <= 12 && visibleWidth(pwd) > 12);
	const result = clampPathLength(pwd, 12);
	assert.equal(result, "…/源代码");
	assert.ok(visibleWidth(result) <= 12);
});

test("emoji tail truncation never splits a surrogate pair or exceeds the budget", () => {
	const result = clampPathLength("~/x/📁📁📁name", 6);
	assert.ok(result.startsWith("…"));
	assert.ok(visibleWidth(result) <= 6);
	assert.doesNotThrow(() => encodeURIComponent(result));
});

test("all-CJK fallback stays within the cell budget", () => {
	const pwd = "/一二三四五六七";
	assert.ok(pwd.length <= 8 && visibleWidth(pwd) > 8);
	const result = clampPathLength(pwd, 8);
	assert.equal(result, "…五六七");
	assert.ok(visibleWidth(result) <= 8);
});
