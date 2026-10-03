import assert from "node:assert/strict";
import test from "node:test";
import { resetCapabilitiesCache, setCapabilities, setCapabilityOverrides } from "@earendil-works/pi-tui";
import { NvidiaGreenBorder } from "../nvidia-green.ts";
import { RainbowBorder } from "../rainbow.ts";
import { detectColorMode, hexToFgAnsi, theme } from "../theme.ts";

function forceTrueColor(trueColor: boolean): void {
	setCapabilities({ images: null, trueColor, hyperlinks: false });
}

function resetCapabilities(): void {
	setCapabilityOverrides({});
	resetCapabilitiesCache();
}

test("forced 256-color capabilities select 256-color escapes", () => {
	try {
		forceTrueColor(false);
		assert.equal(detectColorMode(), "256color");
		assert.equal(hexToFgAnsi("#ff0000"), "\x1b[38;5;196m");
	} finally {
		resetCapabilities();
	}
});

test("forced truecolor capabilities select 24-bit escapes", () => {
	try {
		forceTrueColor(true);
		assert.equal(detectColorMode(), "truecolor");
		assert.equal(hexToFgAnsi("#ff0000"), "\x1b[38;2;255;0;0m");
	} finally {
		resetCapabilities();
	}
});

test("the shared theme invalidates cached escapes when the mode changes", () => {
	try {
		forceTrueColor(true);
		assert.match(theme.getFgAnsi("statusLineBg"), /^\x1b\[38;2;/);
		assert.match(theme.getBgAnsi(), /^\x1b\[48;2;/);

		forceTrueColor(false);
		assert.match(theme.getFgAnsi("statusLineBg"), /^\x1b\[38;5;/);
		assert.match(theme.getBgAnsi(), /^\x1b\[48;5;/);
		assert.match(theme.fadeFg("warning", "statusLineBg", 2, "x"), /^\x1b\[38;5;/);
		assert.match(theme.fadeAnsi("\x1b[38;2;254;188;56mA\x1b[39m", 0.5), /^\x1b\[38;5;/);

		forceTrueColor(true);
		assert.match(theme.getFgAnsi("statusLineBg"), /^\x1b\[38;2;/);
	} finally {
		resetCapabilities();
	}
});

test("session-long border colorizers follow mode changes", () => {
	try {
		forceTrueColor(true);
		const rainbow = new RainbowBorder(0);
		const nvidia = new NvidiaGreenBorder(0);
		assert.match(rainbow.colorChar("─", 0, 28), /^\x1b\[38;2;/);
		assert.match(nvidia.colorChar("─", 0, 28), /^\x1b\[38;2;/);

		forceTrueColor(false);
		assert.match(rainbow.colorChar("─", 0, 28), /^\x1b\[38;5;/);
		assert.match(nvidia.colorChar("─", 0, 28), /^\x1b\[38;5;/);

		forceTrueColor(true);
		assert.match(rainbow.colorChar("─", 0, 28), /^\x1b\[38;2;/);
		assert.match(nvidia.colorChar("─", 0, 28), /^\x1b\[38;2;/);
	} finally {
		resetCapabilities();
	}
});

test("pi capability overrides take precedence over terminal hints", () => {
	const previousColorTerm = process.env.COLORTERM;
	try {
		process.env.COLORTERM = "truecolor";
		setCapabilityOverrides({ trueColor: false });
		assert.equal(detectColorMode(), "256color");
		assert.match(theme.getFgAnsi("statusLineBg"), /^\x1b\[38;5;/);
	} finally {
		if (previousColorTerm === undefined) delete process.env.COLORTERM;
		else process.env.COLORTERM = previousColorTerm;
		resetCapabilities();
	}
});

test("PI_TRUE_COLOR controls capability detection", () => {
	const previousTrueColor = process.env.PI_TRUE_COLOR;
	const previousHyperlinks = process.env.PI_HYPERLINKS;
	try {
		process.env.PI_HYPERLINKS = "0";
		process.env.PI_TRUE_COLOR = "0";
		resetCapabilitiesCache();
		assert.equal(detectColorMode(), "256color");

		process.env.PI_TRUE_COLOR = "1";
		resetCapabilitiesCache();
		assert.equal(detectColorMode(), "truecolor");
	} finally {
		if (previousTrueColor === undefined) delete process.env.PI_TRUE_COLOR;
		else process.env.PI_TRUE_COLOR = previousTrueColor;
		if (previousHyperlinks === undefined) delete process.env.PI_HYPERLINKS;
		else process.env.PI_HYPERLINKS = previousHyperlinks;
		resetCapabilities();
	}
});
