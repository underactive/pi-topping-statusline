/**
 * Contracts for the opt-in embedded working indicator: the `working` segment
 * passes pi's pre-rendered status through verbatim, the top-left group swaps
 * everything but the Pi symbol for it while a stream is live, and the layout
 * truncates it (no ellipsis) before any other left segment is dropped.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildStatusLine } from "../layout.ts";
import { SEGMENTS } from "../segments.ts";
import { resolveEffectiveSettings, topLeftSegments } from "../settings.ts";
import { easeFade, theme } from "../theme.ts";
import type { SegmentContext, StatusLineSegmentId } from "../types.ts";

const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const noGap = (s: string) => s;

const EFFECTIVE = resolveEffectiveSettings({ transparent: true });

function ctxWith(workingStatus: string | undefined): SegmentContext {
	return {
		options: EFFECTIVE.segmentOptions,
		model: undefined,
		thinkingLevel: "off",
		cwd: "/tmp/pi-topping-statusline-tests",
		sessionName: undefined,
		contextPercent: null,
		contextTokens: 0,
		contextWindow: 0,
		git: { branch: null, status: null, pr: null },
		worktree: null,
		scrollHint: undefined,
		piStats: undefined,
		tokenRate: undefined,
		feedData: undefined,
		workingStatus,
	};
}

test("working segment renders the host text verbatim", () => {
	const status = "\x1b[36m⠙ Working\x1b[39m";
	assert.deepEqual(SEGMENTS.working.render(ctxWith(status)), { content: status, visible: true });
});

test("working segment is invisible when idle", () => {
	assert.equal(SEGMENTS.working.render(ctxWith(undefined)).visible, false);
	assert.equal(SEGMENTS.working.render(ctxWith("")).visible, false);
});

test("topLeftSegments keeps pi first and swaps the rest while streaming", () => {
	assert.deepEqual(topLeftSegments(EFFECTIVE, true), ["pi", "working"]);
	assert.deepEqual(topLeftSegments(EFFECTIVE, false), EFFECTIVE.leftSegments);
	assert.ok(EFFECTIVE.leftSegments.length > 2, "default left group has more than pi + one segment");
});

test("topLeftSegments yields only working when the pi symbol is off", () => {
	const noPi = resolveEffectiveSettings({ segments: { pi: false } });
	assert.deepEqual(topLeftSegments(noPi, true), ["working"]);
});

test("embedWorkingStatus resolves off by default and on when set", () => {
	assert.equal(resolveEffectiveSettings({}).embedWorkingStatus, false);
	assert.equal(resolveEffectiveSettings({ embedWorkingStatus: true }).embedWorkingStatus, true);
});

test("top bar renders pi symbol, separator, then the status", () => {
	const bar = buildStatusLine(80, ctxWith("⠙ Mulling 28 tps"), EFFECTIVE, noGap, {
		left: ["pi", "working"],
		right: [],
	});
	const plain = stripAnsi(bar);
	const piAt = plain.indexOf(theme.icon.pi);
	const statusAt = plain.indexOf("⠙ Mulling 28 tps");
	assert.ok(piAt >= 0, "pi symbol present");
	assert.ok(statusAt > piAt, "status follows the pi symbol");
	assert.equal(visibleWidth(bar), 80);
});

test("narrow widths truncate the status without an ellipsis and keep the pi symbol", () => {
	const status = "⠙ Mulling ⣾⣿⣿⣿⣿⣿⣾⣾  28 tps · 11s · ↓ 316 tokens";
	const bar = buildStatusLine(20, ctxWith(status), EFFECTIVE, noGap, { left: ["pi", "working"], right: [] });
	const plain = stripAnsi(bar);
	assert.ok(plain.includes(theme.icon.pi), "pi symbol survives");
	assert.ok(plain.includes("⠙ Mull"), "status head is kept");
	assert.ok(!plain.includes("…"), "no ellipsis");
	assert.ok(!plain.includes("tokens"), "status tail is cut");
	assert.equal(visibleWidth(bar), 20);
});

test("a long ANSI-styled status never exceeds the bar width", () => {
	const status = `\x1b[38;2;10;20;30m⠙ ${"Working ".repeat(30)}\x1b[39m`;
	for (const width of [12, 16, 24, 40, 60]) {
		const bar = buildStatusLine(width, ctxWith(status), EFFECTIVE, noGap, {
			left: ["pi", "working"],
			right: [],
		});
		assert.equal(visibleWidth(bar), width, `width ${width}`);
		assert.ok(stripAnsi(bar).includes(theme.icon.pi), `pi symbol at width ${width}`);
	}
});

test("the status drops entirely rather than the pi symbol when there is no room", () => {
	const bar = buildStatusLine(4, ctxWith("⠙ Working"), EFFECTIVE, noGap, { left: ["pi", "working"], right: [] });
	const plain = stripAnsi(bar);
	assert.ok(plain.includes(theme.icon.pi));
	assert.ok(!plain.includes("⠙"));
});

test("fadeAnsi leaves text untouched at full opacity and sinks colors into the bar at zero", () => {
	const styled = "\x1b[38;2;254;188;56mA\x1b[39m \x1b[48;5;70mB\x1b[49m";
	assert.equal(theme.fadeAnsi(styled, 1), styled);
	const sunk = theme.fadeAnsi(styled, 0);
	assert.equal(stripAnsi(sunk), stripAnsi(styled));
	assert.ok(!sunk.includes("254;188;56"), "accent fg blended away");
	// #121212 is the bar background; every color plane lands on it, 49 is kept.
	assert.ok(/38;2;18;18;18m|38;5;\d+m/.test(sunk));
	assert.ok(sunk.includes("\x1b[49m"));
});

test("easeFade is monotonic and pinned at both ends", () => {
	assert.equal(easeFade(0), 0);
	assert.equal(easeFade(1), 1);
	assert.ok(easeFade(0.25) < easeFade(0.5) && easeFade(0.5) < easeFade(0.75));
});

test("leftFade recolors the tail but not the pi symbol or the bar width", () => {
	const status = "\x1b[38;2;10;200;30m⠙ Working\x1b[39m";
	const groups: { left: StatusLineSegmentId[]; right: StatusLineSegmentId[] } = { left: ["pi", "working"], right: [] };
	const origin = { col: 0, row: 0 };
	const build = (fade?: number) =>
		buildStatusLine(60, ctxWith(status), EFFECTIVE, noGap, groups, origin, { leftFade: fade });
	const solid = build();
	const faded = build(0.2);
	assert.equal(visibleWidth(faded), 60);
	assert.equal(stripAnsi(faded), stripAnsi(solid));
	assert.ok(!faded.includes("10;200;30"), "status color blended");
	const piPrefix = (bar: string) => bar.slice(0, bar.indexOf(theme.icon.pi));
	assert.equal(piPrefix(faded), piPrefix(solid), "pi symbol styling untouched");
	assert.equal(build(1), solid);
});
