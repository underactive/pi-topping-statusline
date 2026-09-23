/**
 * Contracts for the opt-in embedded status indicator: the `working` segment
 * passes pi's pre-rendered status through verbatim, the top-left group keeps
 * the Pi symbol and configured model details while a stream is live, and the
 * layout truncates it before any other left segment is dropped. The caller
 * chooses whether truncated status text uses an ellipsis, and how far an
 * appearing status has slid out ahead of the model details.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { stripAnsi } from "../footer.ts";
import { buildStatusLine } from "../layout.ts";
import { SEGMENTS } from "../segments.ts";
import { getSeparator } from "../separators.ts";
import { resolveEffectiveSettings, topLeftSegments } from "../settings.ts";
import { easeFade, theme } from "../theme.ts";
import type { SegmentContext, StatusLineSegmentId } from "../types.ts";

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

test("topLeftSegments keeps pi and model details around the working status", () => {
	assert.deepEqual(topLeftSegments(EFFECTIVE, true), ["pi", "working", "model"]);
	assert.deepEqual(topLeftSegments(EFFECTIVE, false), EFFECTIVE.leftSegments);
	assert.ok(EFFECTIVE.leftSegments.includes("path"), "default path segment is suppressed while working");
});

test("topLeftSegments respects disabled pi and model details", () => {
	const noPi = resolveEffectiveSettings({ segments: { pi: false } });
	assert.deepEqual(topLeftSegments(noPi, true), ["working", "model"]);

	const noModelDetails = resolveEffectiveSettings({
		segments: { model: false, provider: false, thinking: false },
	});
	assert.deepEqual(topLeftSegments(noModelDetails, true), ["pi", "working"]);
});

test("embedWorkingStatus resolves off by default and on when set", () => {
	assert.equal(resolveEffectiveSettings({}).embedWorkingStatus, false);
	assert.equal(resolveEffectiveSettings({ embedWorkingStatus: true }).embedWorkingStatus, true);
});

test("top bar renders pi symbol, status, then model details", () => {
	const ctx = ctxWith("⠙ Mulling 28 tps");
	ctx.model = { name: "GPT-5.6 Luna", id: "gpt-5.6", provider: "openai-codex", reasoning: true };
	ctx.thinkingLevel = "max";
	const effective = resolveEffectiveSettings({
		transparent: true,
		segments: { model: true, provider: true, thinking: true },
	});
	ctx.options = effective.segmentOptions;
	const bar = buildStatusLine(120, ctx, effective, noGap, {
		left: topLeftSegments(effective, true),
		right: [],
	});
	const plain = stripAnsi(bar);
	const piAt = plain.indexOf(theme.icon.pi);
	const statusAt = plain.indexOf("⠙ Mulling 28 tps");
	const modelAt = plain.indexOf("GPT-5.6 Luna");
	assert.ok(piAt >= 0, "pi symbol present");
	assert.ok(statusAt > piAt, "status follows the pi symbol");
	assert.ok(modelAt > statusAt, "model details follow the status");
	assert.ok(plain.includes("openai-codex"), "provider remains visible");
	assert.ok(plain.includes("max"), "thinking level remains visible");
	assert.equal(visibleWidth(bar), 120);
});

test("narrow widths truncate the status before dropping model details", () => {
	const status = "⠙ Mulling ⣾⣿⣿⣿⣿⣿⣾⣾  28 tps · 11s · ↓ 316 tokens";
	const ctx = ctxWith(status);
	ctx.model = { name: "Luna", id: "luna", provider: "openai-codex", reasoning: false };
	const bar = buildStatusLine(24, ctx, EFFECTIVE, noGap, {
		left: topLeftSegments(EFFECTIVE, true),
		right: [],
	});
	const plain = stripAnsi(bar);
	assert.ok(plain.includes(theme.icon.pi), "pi symbol survives");
	assert.ok(plain.includes("⠙ Mull"), "status head is kept");
	assert.ok(plain.includes("Luna"), "model details survive");
	assert.ok(!plain.includes("…"), "no ellipsis");
	assert.ok(!plain.includes("tokens"), "status tail is cut");
	assert.equal(visibleWidth(bar), 24);
});

test("opaque bars restore the group background after truncating the status", () => {
	const status = "⠙ Mulling ⣾⣿⣿⣿⣿⣿⣾⣾  28 tps · 11s · ↓ 316 tokens";
	const ctx = ctxWith(status);
	ctx.model = { name: "Luna", id: "luna", provider: "openai-codex", reasoning: false };
	const opaque = resolveEffectiveSettings({ transparent: false });
	ctx.options = opaque.segmentOptions;
	const bar = buildStatusLine(24, ctx, opaque, noGap, {
		left: topLeftSegments(opaque, true),
		right: [],
	});
	const plain = stripAnsi(bar);
	assert.ok(plain.includes("⠙ Mull"), "status head is kept");
	assert.ok(!plain.includes("tokens"), "status tail is cut");
	const reset = theme.getBgAnsi() + theme.getFgAnsi("text");
	const resetAt = bar.indexOf(reset);
	const modelAt = bar.indexOf("Luna");
	assert.ok(resetAt >= 0, "group background and text color are re-asserted after the truncated status");
	assert.ok(resetAt < modelAt, "the reset lands before the model text");
});

test("overflow drops trailing model details before touching the live status", () => {
	const status = "⠙ Working";
	const ctx = ctxWith(status);
	ctx.model = { name: "GPT-5.6 Luna", id: "gpt-5.6", provider: "openai-codex", reasoning: true };
	ctx.thinkingLevel = "max";
	const effective = resolveEffectiveSettings({
		transparent: true,
		segments: { model: true, provider: true, thinking: true },
	});
	ctx.options = effective.segmentOptions;
	const bar = buildStatusLine(34, ctx, effective, noGap, {
		left: topLeftSegments(effective, true),
		right: [],
	});
	const plain = stripAnsi(bar);
	assert.ok(plain.includes(theme.icon.pi), "pi symbol survives");
	assert.ok(plain.includes("⠙ Working"), "the spinner status survives untruncated");
	assert.ok(!plain.includes("GPT-5.6"), "model details are dropped to protect the live status");
	assert.equal(visibleWidth(bar), 34);
});

test("workingEllipsis marks truncated prose without changing the bar width", () => {
	const status = "⠙ Context overflow detected, Auto-compacting... (esc to cancel)";
	for (const width of [24, 40, 60]) {
		const bar = buildStatusLine(
			width,
			ctxWith(status),
			EFFECTIVE,
			noGap,
			{ left: topLeftSegments(EFFECTIVE, true), right: [] },
			{ col: 0, row: 0 },
			{ workingEllipsis: "…" },
		);
		const plain = stripAnsi(bar);
		assert.ok(plain.includes(theme.icon.pi), `pi symbol survives at width ${width}`);
		assert.ok(plain.includes("…"), `truncated status ends with an ellipsis at width ${width}`);
		assert.ok(!plain.includes("cancel"), `status tail is cut at width ${width}`);
		assert.equal(visibleWidth(bar), width, `width ${width}`);
	}
});

test("a long ANSI-styled status never exceeds the bar width", () => {
	const status = `\x1b[38;2;10;20;30m⠙ ${"Working ".repeat(30)}\x1b[39m`;
	for (const width of [12, 16, 24, 40, 60]) {
		const bar = buildStatusLine(width, ctxWith(status), EFFECTIVE, noGap, {
			left: topLeftSegments(EFFECTIVE, true),
			right: [],
		});
		assert.equal(visibleWidth(bar), width, `width ${width}`);
		assert.ok(stripAnsi(bar).includes(theme.icon.pi), `pi symbol at width ${width}`);
	}
});

test("the status drops entirely rather than the pi symbol when there is no room", () => {
	const bar = buildStatusLine(4, ctxWith("⠙ Working"), EFFECTIVE, noGap, {
		left: topLeftSegments(EFFECTIVE, true),
		right: [],
	});
	const plain = stripAnsi(bar);
	assert.ok(plain.includes(theme.icon.pi));
	assert.ok(!plain.includes("⠙"));
});

test("fadeAnsi leaves text untouched at full opacity and sinks colors into the bar at zero", () => {
	const styled = "\x1b[38;2;254;188;56mA\x1b[39m \x1b[48;5;70mB\x1b[49m";
	assert.equal(theme.fadeAnsi(styled, 1), styled);
	const sunk = theme.fadeAnsi(styled, 0);
	assert.equal(
		sunk,
		`${theme.getFgAnsi("statusLineBg")}A${theme.getFgAnsi("statusLineBg")} ${theme.getBgAnsi()}B\x1b[49m`,
	);
});

test("easeFade is monotonic and pinned at both ends", () => {
	assert.equal(easeFade(0), 0);
	assert.equal(easeFade(1), 1);
	assert.ok(easeFade(0.25) < easeFade(0.5) && easeFade(0.5) < easeFade(0.75));
});

test("leftFade recolors the working status but not pi or model details", () => {
	const status = "\x1b[38;2;10;200;30m⠙ Working\x1b[39m";
	const ctx = ctxWith(status);
	ctx.model = { name: "Luna", id: "luna", provider: "openai-codex", reasoning: false };
	const groups: { left: StatusLineSegmentId[]; right: StatusLineSegmentId[] } = {
		left: topLeftSegments(EFFECTIVE, true),
		right: [],
	};
	const origin = { col: 0, row: 0 };
	const build = (fade?: number) => buildStatusLine(60, ctx, EFFECTIVE, noGap, groups, origin, { leftFade: fade });
	const solid = build();
	const faded = build(0.2);
	const renderedModel = SEGMENTS.model.render(ctx);
	assert.equal(visibleWidth(faded), 60);
	assert.equal(stripAnsi(faded), stripAnsi(solid));
	assert.ok(!faded.includes("10;200;30"), "status color blended");
	assert.ok(renderedModel.visible && faded.includes(renderedModel.content), "model styling untouched");
	const piPrefix = (bar: string) => bar.slice(0, bar.indexOf(theme.icon.pi));
	assert.equal(piPrefix(faded), piPrefix(solid), "pi symbol styling untouched");
	assert.equal(build(1), solid);
});

test("leftFade does not recolor the right group", () => {
	const ctx = ctxWith("⠙ Working");
	ctx.sessionName = "stable-session";
	const renderedSession = SEGMENTS.session_name.render(ctx);
	const bar = buildStatusLine(
		80,
		ctx,
		EFFECTIVE,
		noGap,
		{ left: topLeftSegments(EFFECTIVE, true), right: ["session_name"] },
		{ col: 0, row: 0 },
		{ leftFade: 0.2 },
	);
	assert.ok(renderedSession.visible && bar.includes(renderedSession.content), "right group styling untouched");
});

/** A top bar mid-slide, with the status revealed by `reveal` and Luna as the model. */
function slidingBar(
	status: string,
	reveal: number | undefined,
	{ width = 60, effective = EFFECTIVE, leftFade }: {
		width?: number;
		effective?: ReturnType<typeof resolveEffectiveSettings>;
		leftFade?: number;
	} = {},
): string {
	const ctx = ctxWith(status);
	ctx.options = effective.segmentOptions;
	ctx.model = { name: "Luna", id: "luna", provider: "openai-codex", reasoning: false };
	ctx.sessionName = "stable-session";
	return buildStatusLine(
		width,
		ctx,
		effective,
		noGap,
		{ left: topLeftSegments(effective, true), right: ["session_name"] },
		{ col: 0, row: 0 },
		{ leftFade, workingReveal: reveal },
	);
}

test("workingReveal slides the status out behind the pi symbol, pushing model details right", () => {
	const settled = slidingBar("⠙ Working...", undefined);
	const piAt = stripAnsi(settled).indexOf(theme.icon.pi);
	assert.equal(slidingBar("⠙ Working...", 1), settled);
	assert.ok(!stripAnsi(slidingBar("⠙ Working...", 0)).includes("⠙"), "nothing has emerged at the start");

	let modelAt = -1;
	for (let step = 0; step <= 30; step++) {
		const bar = slidingBar("⠙ Working...", step / 30);
		const plain = stripAnsi(bar);
		assert.equal(visibleWidth(bar), 60, `width at step ${step}`);
		assert.equal(plain.indexOf(theme.icon.pi), piAt, `pi symbol stays put at step ${step}`);
		const at = plain.indexOf("Luna");
		assert.ok(at >= modelAt, `model details never move left at step ${step}`);
		modelAt = at;
	}
	assert.equal(modelAt, stripAnsi(settled).indexOf("Luna"), "model details end where they settle");
});

test("the status's tail emerges first, led by its trailing separator", () => {
	const status = "⠙ Working...";
	const sep = getSeparator(EFFECTIVE.separator).left;
	const unitWidth = visibleWidth(status) + visibleWidth(sep) + 2;
	const frame = (shown: number) => stripAnsi(slidingBar(status, shown / unitWidth));
	const model = `${theme.icon.model} Luna`;
	assert.ok(frame(2).includes(`${theme.icon.pi} ${sep} ${sep} ${model}`), "separator first");
	assert.ok(frame(7).includes(`${theme.icon.pi} ${sep} g... ${sep} ${model}`), "then the status's tail");
	assert.ok(!frame(7).includes("Workin"), "the head is still hidden");
});

test("without model details the status slides out alone after the pi separator", () => {
	const effective = resolveEffectiveSettings({
		transparent: true,
		segments: { model: false, provider: false, thinking: false },
	});
	const sep = getSeparator(effective.separator).left;
	assert.ok(!stripAnsi(slidingBar("⠙ Working...", 0, { effective })).includes(sep), "no separator yet");
	const plain = stripAnsi(slidingBar("⠙ Working...", 4 / 12, { effective }));
	assert.ok(plain.includes(`${theme.icon.pi} ${sep} g...`), "tail follows the pi separator");
	assert.ok(!plain.includes("Workin"), "the head is still hidden");
});

test("the slide keeps the overflow decided for the fully revealed status", () => {
	// At 40 cells the settled status leaves no room for the session name, even
	// though a partly revealed one would.
	assert.ok(!stripAnsi(slidingBar("⠙ Working...", undefined, { width: 40 })).includes("stable-session"));
	for (let step = 0; step <= 20; step++) {
		const bar = slidingBar("⠙ Working...", step / 20, { width: 40 });
		assert.ok(!stripAnsi(bar).includes("stable-session"), `right group stays dropped at step ${step}`);
	}
});

test("sliding frames keep the bar width with opaque caps, wide glyphs, and truncation", () => {
	const opaque = resolveEffectiveSettings({ transparent: false });
	const statuses = ["⠙ Working...", "🌑 Working", `\x1b[38;2;10;20;30m⠙ ${"Working ".repeat(10)}\x1b[39m`];
	for (const effective of [EFFECTIVE, opaque]) {
		for (const status of statuses) {
			for (const width of [24, 60]) {
				for (let step = 0; step <= 20; step++) {
					const bar = slidingBar(status, step / 20, { width, effective });
					assert.equal(visibleWidth(bar), width, `${JSON.stringify(status)} at width ${width}, step ${step}`);
				}
			}
		}
	}
});

test("a status fading mid-slide blends its emerged tail but not model details", () => {
	const status = "\x1b[38;2;10;200;30m⠙ Working...\x1b[39m";
	const bar = slidingBar(status, 0.5, { leftFade: 0.2 });
	const ctx = ctxWith(status);
	ctx.model = { name: "Luna", id: "luna", provider: "openai-codex", reasoning: false };
	const renderedModel = SEGMENTS.model.render(ctx);
	assert.ok(stripAnsi(bar).includes("..."), "part of the status has emerged");
	assert.ok(!bar.includes("10;200;30"), "emerged status blended");
	assert.ok(renderedModel.visible && bar.includes(renderedModel.content), "model styling untouched");
	assert.equal(visibleWidth(bar), 60);
});
