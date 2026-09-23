/**
 * Contracts for the response model a provider reports for the latest reply (a
 * router's resolved model, a fallback): the model segment appends it after the
 * configured details, it slides out from behind its joining dot the way an
 * embedded status slides out from behind the Pi chevron, and it is the first
 * left-group content to give way when the bar overflows.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildStatusLine } from "../layout.ts";
import { SEGMENTS, responseModelSuffix } from "../segments.ts";
import { getSeparator } from "../separators.ts";
import { resolveEffectiveSettings, topLeftSegments } from "../settings.ts";
import { theme } from "../theme.ts";
import type { SegmentContext, StatusLineSegmentId } from "../types.ts";

const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
const noGap = (s: string) => s;

const EFFECTIVE = resolveEffectiveSettings({ transparent: true });
const LABEL = "anthropic/claude-haiku-4.5";
const SEP = getSeparator(EFFECTIVE.separator).left;
/** Cells the label slides through ahead of the path: itself and the separator to the path. */
const MOVING_WIDTH = visibleWidth(LABEL) + visibleWidth(SEP) + 2;

function ctxWith(responseModel: string | undefined, effective = EFFECTIVE): SegmentContext {
	return {
		options: effective.segmentOptions,
		model: { name: "Auto", id: "openrouter/auto", provider: "openrouter", reasoning: false },
		responseModel,
		thinkingLevel: "off",
		cwd: "/tmp/pi-topping-statusline-tests",
		sessionName: "stable-session",
		contextPercent: null,
		contextTokens: 0,
		contextWindow: 0,
		git: { branch: null, status: null, pr: null },
		worktree: null,
		scrollHint: undefined,
		piStats: undefined,
		tokenRate: undefined,
		feedData: undefined,
		workingStatus: undefined,
	};
}

const PATH = stripAnsi(SEGMENTS.path.render(ctxWith(undefined)).content);

/** A top bar with the response model revealed by `reveal`, ahead of the path by default. */
function bar(
	reveal: number | undefined,
	{
		width = 110,
		effective = EFFECTIVE,
		responseModel = LABEL,
		left = ["pi", "model", "path"],
		workingStatus,
		workingReveal,
	}: {
		width?: number;
		effective?: ReturnType<typeof resolveEffectiveSettings>;
		/** null for a reply with no reported response model. */
		responseModel?: string | null;
		left?: StatusLineSegmentId[];
		workingStatus?: string;
		workingReveal?: number;
	} = {},
): string {
	const ctx = { ...ctxWith(responseModel ?? undefined, effective), workingStatus };
	return buildStatusLine(
		width,
		ctx,
		effective,
		noGap,
		{ left, right: ["session_name"] },
		{ col: 0, row: 0 },
		{ responseModelReveal: reveal, workingReveal },
	);
}

/** Visible column where `text` starts in `rendered`, or -1. */
function columnOf(rendered: string, text: string): number {
	const plain = stripAnsi(rendered);
	const at = plain.indexOf(text);
	return at < 0 ? -1 : visibleWidth(plain.slice(0, at));
}

test("the model segment appends a response model after its details, joined by the dot", () => {
	const content = stripAnsi(SEGMENTS.model.render(ctxWith(LABEL)).content);
	assert.ok(content.endsWith(`Auto${theme.sep.dot}${LABEL}`), content);
});

test("no response model is added when it repeats the configured model or model names are hidden", () => {
	const plain = SEGMENTS.model.render(ctxWith(undefined)).content;
	assert.equal(SEGMENTS.model.render(ctxWith("openrouter/auto")).content, plain);
	assert.equal(responseModelSuffix(ctxWith("openrouter/auto")), undefined);

	const hidden = resolveEffectiveSettings({ transparent: true, segments: { model: false, provider: true } });
	assert.equal(responseModelSuffix(ctxWith(LABEL, hidden)), undefined);
	assert.ok(!stripAnsi(SEGMENTS.model.render(ctxWith(LABEL, hidden)).content).includes(LABEL));
	for (let step = 0; step <= 10; step++) {
		assert.equal(bar(step / 10, { effective: hidden }), bar(undefined, { effective: hidden }), `no slide at ${step}`);
	}
});

test("before its first cell emerges, the bar matches one without a response model", () => {
	assert.equal(bar(0), bar(undefined, { responseModel: null }));
	assert.equal(bar(1), bar(undefined));
});

test("the label slides out tail first from behind its dot, led by the separator to the path", () => {
	const frame = (shown: number) => stripAnsi(bar(shown / MOVING_WIDTH));
	const dot = theme.sep.dot;
	assert.ok(frame(2).includes(`Auto${dot}${SEP} ${PATH}`), "the separator emerges first, behind the dot");
	assert.ok(frame(3 + 3).includes(`Auto${dot}4.5 ${SEP} ${PATH}`), "then the label's tail");
	assert.ok(!frame(3 + 3).includes("anthropic"), "the head is still hidden");
});

test("the path only moves right while the configured model details stay put", () => {
	const settled = bar(undefined);
	const modelAt = columnOf(settled, "Auto");
	assert.ok(modelAt >= 0 && columnOf(settled, PATH) >= 0, "model details and path are both on the bar");

	let pathAt = -1;
	for (let step = 0; step <= 40; step++) {
		const frame = bar(step / 40);
		assert.equal(visibleWidth(frame), 110, `width at step ${step}`);
		assert.equal(columnOf(frame, "Auto"), modelAt, `model details stay put at step ${step}`);
		const at = columnOf(frame, PATH);
		assert.ok(at >= 0 && at >= pathAt, `path never moves left at step ${step}`);
		pathAt = at;
	}
	assert.equal(pathAt, columnOf(settled, PATH), "the path ends where it settles");
});

test("the emerging label keeps the model color", () => {
	const frame = bar((3 + 5) / MOVING_WIDTH);
	assert.ok(frame.includes(`${theme.getFgAnsi("statusLineModel")}u-4.5`));
});

test("a response model that cannot fit gives way before anything else on the bar", () => {
	// At 70 cells the label does not fit even without the session name, so the
	// bar keeps everything it would show without a response model.
	const withoutLabel = bar(undefined, { width: 70, responseModel: null });
	for (const text of ["Auto", PATH, "stable-session"]) assert.ok(stripAnsi(withoutLabel).includes(text), text);
	for (let step = 0; step <= 20; step++) {
		assert.equal(bar(step / 20, { width: 70 }), withoutLabel, `nothing slides at step ${step}`);
	}
});

test("the right group yields to a response model that then fits, for the whole slide", () => {
	// At 80 cells the label fits once the session name is gone.
	assert.ok(stripAnsi(bar(undefined, { width: 80 })).includes(LABEL));
	for (let step = 0; step <= 20; step++) {
		assert.ok(!stripAnsi(bar(step / 20, { width: 80 })).includes("stable-session"), `dropped at step ${step}`);
	}
});

test("beside an embedded status the label slides out at the end of the group", () => {
	const left = topLeftSegments(EFFECTIVE, true);
	const workingStatus = "⠙ Working...";
	const settled = bar(undefined, { left, workingStatus });
	const statusAt = columnOf(settled, "Working");
	assert.ok(stripAnsi(bar(0.5, { left, workingStatus })).includes(`Auto${theme.sep.dot}`), "the dot leads the label");
	for (let step = 0; step <= 20; step++) {
		const frame = bar(step / 20, { left, workingStatus });
		assert.equal(columnOf(frame, "Working"), statusAt, `status stays put at step ${step}`);
		assert.equal(visibleWidth(frame), 110, `width at step ${step}`);
	}
});

test("sliding frames keep the bar width alongside a sliding status, opaque caps, and narrow widths", () => {
	const opaque = resolveEffectiveSettings({ transparent: false });
	for (const effective of [EFFECTIVE, opaque]) {
		for (const width of [24, 70, 110]) {
			for (let step = 0; step <= 10; step++) {
				const reveal = step / 10;
				assert.equal(visibleWidth(bar(reveal, { width, effective })), width, `alone at ${width}, step ${step}`);
				const beside = bar(reveal, {
					width,
					effective,
					left: topLeftSegments(effective, true),
					workingStatus: "⠙ Working...",
					workingReveal: reveal,
				});
				assert.equal(visibleWidth(beside), width, `beside a status at ${width}, step ${step}`);
			}
		}
	}
});
