import assert from "node:assert/strict";
import test from "node:test";
import {
	GREEN_BIAS,
	GREEN_SHADE_COUNT,
	NVIDIA_GREEN_DARK_HEX,
	NVIDIA_GREEN_HEX,
	NvidiaGreenBorder,
	isSwitchyardProvider,
} from "../nvidia-green.ts";
import { resolveEffectiveSettings } from "../settings.ts";
import { detectColorMode, hexToFgAnsi } from "../theme.ts";

test("recognizes the Switchyard provider case-insensitively after trimming", () => {
	assert.equal(isSwitchyardProvider("switchyard"), true);
	assert.equal(isSwitchyardProvider(" Switchyard "), true);
	assert.equal(isSwitchyardProvider(undefined), false);
	assert.equal(isSwitchyardProvider(""), false);
	assert.equal(isSwitchyardProvider("other"), false);
});

test("switchyard green settings default to true and resolve explicit false", () => {
	const defaults = resolveEffectiveSettings({});
	assert.equal(defaults.nvidiaGreenBorder, true);
	assert.equal(defaults.nvidiaGreenAnimation, true);
	const off = resolveEffectiveSettings({ nvidiaGreenBorder: false, nvidiaGreenAnimation: false });
	assert.equal(off.nvidiaGreenBorder, false);
	assert.equal(off.nvidiaGreenAnimation, false);
});

test("colorChar wraps a glyph in a color escape and foreground reset", () => {
	const border = new NvidiaGreenBorder();
	assert.match(border.colorChar("─", 0, 28), /^\x1b\[38;(2;\d+;\d+;\d+|5;\d+)m─\x1b\[39m$/);
});

test("phase zero has bright and dark opposite endpoints", () => {
	const mode = detectColorMode();
	const border = new NvidiaGreenBorder(0);
	assert.equal(border.colorChar("─", 0, 28), `${hexToFgAnsi(NVIDIA_GREEN_HEX, mode)}─\x1b[39m`);
	assert.equal(border.colorChar("─", 14, 28), `${hexToFgAnsi(NVIDIA_GREEN_DARK_HEX, mode)}─\x1b[39m`);
});

test("step by one full turn preserves the color", () => {
	const stepped = new NvidiaGreenBorder(37);
	const unchanged = new NvidiaGreenBorder(37);
	stepped.step(360);
	assert.equal(stepped.colorChar("─", 7, 28), unchanged.colorChar("─", 7, 28));
});

test("opposite positions receive different shades", () => {
	const border = new NvidiaGreenBorder();
	assert.notEqual(border.colorChar("─", 0, 28), border.colorChar("─", 14, 28));
	assert.equal(GREEN_SHADE_COUNT, 256);
	assert.equal(GREEN_BIAS, 0.65);
});
