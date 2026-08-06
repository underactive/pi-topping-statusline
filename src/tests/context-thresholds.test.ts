/**
 * Context threshold bands: percent vs. token-derived caps, and
 * formatContextUsage's unknown-window/unknown-percent rendering.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { formatContextUsage, getContextUsageLevel } from "../context-thresholds.ts";

test("percent bands trigger at 50/70/90 when the window is small enough that token caps don't bind first", () => {
	const window = 200_000;
	assert.equal(getContextUsageLevel(49.9, window), "normal");
	assert.equal(getContextUsageLevel(50, window), "warning");
	assert.equal(getContextUsageLevel(69.9, window), "warning");
	assert.equal(getContextUsageLevel(70, window), "elevated");
	assert.equal(getContextUsageLevel(89.9, window), "elevated");
	assert.equal(getContextUsageLevel(90, window), "error");
});

test("a large window makes the token thresholds bind before the percent thresholds", () => {
	const window = 1_000_000;
	assert.equal(getContextUsageLevel(14.9, window), "normal");
	assert.equal(getContextUsageLevel(15, window), "warning");
	assert.equal(getContextUsageLevel(27, window), "elevated");
	assert.equal(getContextUsageLevel(50, window), "error");
});

test("an unknown window (<=0) falls back to the raw percent thresholds", () => {
	assert.equal(getContextUsageLevel(49, 0), "normal");
	assert.equal(getContextUsageLevel(50, 0), "warning");
	assert.equal(getContextUsageLevel(90, -1), "error");
});

test("zero or negative percent never crosses any threshold", () => {
	assert.equal(getContextUsageLevel(0, 200_000), "normal");
	assert.equal(getContextUsageLevel(-5, 200_000), "normal");
});

test("an unknown window falls back to the raw token count", () => {
	assert.equal(formatContextUsage(42, 0, 1234), "1.2K/?");
	assert.equal(formatContextUsage(42, 0, undefined), "0/?");
});

test("a null or undefined percent against a known window renders '?'", () => {
	assert.equal(formatContextUsage(null, 200_000, 1000), "?/200K");
	assert.equal(formatContextUsage(undefined, 200_000, 1000), "?/200K");
});

test("a known percent renders with one decimal", () => {
	assert.equal(formatContextUsage(42.567, 200_000), "42.6%/200K");
});
