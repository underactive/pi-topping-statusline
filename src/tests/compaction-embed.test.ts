/**
 * Contracts for hosting pi-topping-compact's compaction progress: the broadcast
 * parser, the preconditions for announcing that the bar hosts it, the
 * bottom-right stand-ins, and the two segments that draw the bar and figures.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { hostsCompactionProgress, parseCompactionProgress } from "../compaction-embed.ts";
import { stripAnsi } from "../footer.ts";
import { buildStatusLine } from "../layout.ts";
import { formatCompactionInfo, formatCompactionTokens, SEGMENTS } from "../segments.ts";
import { bottomRightSegments, resolveEffectiveSettings } from "../settings.ts";
import { theme } from "../theme.ts";
import type { CompactionProgressView, SegmentContext } from "../types.ts";

const noGap = (s: string) => s;
const EFFECTIVE = resolveEffectiveSettings({ transparent: true });

const BAR = `\x1b[38;2;114;241;184m${"▋".repeat(7)}\x1b[39m\x1b[2m${"░".repeat(13)}\x1b[22m\x1b[39m`;
const VIEW: CompactionProgressView = {
	bar: BAR,
	percent: 47,
	tokensBefore: 86_000,
	contextWindow: 131_072,
	elapsedMs: 16_300,
};
const DOT = theme.sep.dot;

function ctxWith(compaction: CompactionProgressView | undefined): SegmentContext {
	return {
		options: EFFECTIVE.segmentOptions,
		model: undefined,
		thinkingLevel: "off",
		cwd: "/tmp/pi-topping-statusline-tests",
		sessionName: undefined,
		contextPercent: 41,
		contextTokens: 53_740,
		contextWindow: 131_072,
		git: { branch: null, status: null, pr: null },
		worktree: null,
		scrollHint: undefined,
		piStats: "↑ 142K ↓ 16K R 4.2M",
		tokenRate: undefined,
		feedData: undefined,
		compaction,
	};
}

test("parseCompactionProgress accepts an active broadcast and rejects everything else", () => {
	assert.deepEqual(
		parseCompactionProgress({ active: true, ...VIEW, phase: "summarizing", remainingPercent: 35 }),
		VIEW,
		"the rest of the snapshot is ignored",
	);
	assert.equal(parseCompactionProgress({ active: false }), undefined);
	assert.equal(parseCompactionProgress({ ...VIEW, active: "true" }), undefined);
	assert.equal(parseCompactionProgress({ active: true, ...VIEW, bar: 7 }), undefined);
	assert.equal(parseCompactionProgress({ active: true, ...VIEW, percent: undefined }), undefined);
	assert.equal(parseCompactionProgress({ active: true, ...VIEW, percent: Number.NaN }), undefined);
	assert.equal(parseCompactionProgress({ active: true, ...VIEW, tokensBefore: "86000" }), undefined);
	assert.equal(parseCompactionProgress({ active: true, ...VIEW, elapsedMs: "16.3" }), undefined);
	assert.equal(parseCompactionProgress(undefined), undefined);
	assert.equal(parseCompactionProgress(null), undefined);
	assert.equal(parseCompactionProgress([{ active: true, ...VIEW }]), undefined);
	assert.equal(parseCompactionProgress("active"), undefined);
});

test("embedCompactionProgress resolves on by default and off when set", () => {
	assert.equal(resolveEffectiveSettings({}).embedCompactionProgress, true);
	assert.equal(resolveEffectiveSettings({ embedCompactionProgress: false }).embedCompactionProgress, false);
});

test("the bar hosts the progress only with the setting on and a stand-in slot shown", () => {
	assert.equal(hostsCompactionProgress(EFFECTIVE), true);
	assert.equal(hostsCompactionProgress(resolveEffectiveSettings({ embedCompactionProgress: false })), false);
	const graphOnly = resolveEffectiveSettings({ segments: { piStats: false } });
	assert.equal(hostsCompactionProgress(graphOnly), true, "the context graph alone hosts the bar");
	const statsOnly = resolveEffectiveSettings({ segments: { contextBar: false, contextStats: false } });
	assert.equal(hostsCompactionProgress(statsOnly), true, "pi stats alone host the figures");
	const nowhere = resolveEffectiveSettings({ segments: { piStats: false, contextBar: false, contextStats: false } });
	assert.equal(hostsCompactionProgress(nowhere), false);
});

test("bottomRightSegments swaps in the stand-ins in place while compacting", () => {
	const effective = resolveEffectiveSettings({ segments: { feeds: true, tokenRate: true } });
	assert.deepEqual(effective.bottomRightSegments, ["feeds", "token_rate", "pi_stats", "context_graph"]);
	assert.deepEqual(bottomRightSegments(effective, true), [
		"feeds",
		"token_rate",
		"compaction_info",
		"compaction_graph",
	]);
	assert.equal(bottomRightSegments(effective, false), effective.bottomRightSegments);
});

test("formatCompactionInfo reads how much is summarized and the time taken", () => {
	assert.equal(formatCompactionInfo(VIEW), `47% summarized${DOT}16.3s`);
	assert.equal(formatCompactionInfo({ ...VIEW, percent: 0, elapsedMs: 0 }), `0% summarized${DOT}0.0s`);
	assert.equal(formatCompactionInfo({ ...VIEW, percent: 33.4, elapsedMs: 1_234_567 }), `33% summarized${DOT}1234.6s`);
	assert.equal(formatCompactionInfo({ ...VIEW, percent: 140 }), `100% summarized${DOT}16.3s`, "clamped high");
	assert.equal(formatCompactionInfo({ ...VIEW, percent: -3, elapsedMs: -5 }), `0% summarized${DOT}0.0s`, "clamped low");
});

test("formatCompactionTokens uses the context label's number style", () => {
	assert.equal(formatCompactionTokens(VIEW), "86K/131K (66%)");
	assert.equal(
		formatCompactionTokens({ ...VIEW, tokensBefore: 1_250_000, contextWindow: 2_000_000 }),
		"1.3M/2.0M (63%)",
	);
	assert.equal(formatCompactionTokens({ ...VIEW, contextWindow: 0 }), "86K/?", "no share of an unknown window");
	assert.equal(formatCompactionTokens({ ...VIEW, tokensBefore: 200_000 }), "200K/131K (100%)", "clamped");
});

test("compaction segments are invisible without a hosted compaction", () => {
	assert.equal(SEGMENTS.compaction_info.render(ctxWith(undefined)).visible, false);
	assert.equal(SEGMENTS.compaction_graph.render(ctxWith(undefined)).visible, false);
});

test("compaction_info renders the figures in dim text", () => {
	assert.deepEqual(SEGMENTS.compaction_info.render(ctxWith(VIEW)), {
		content: theme.fg("dim", formatCompactionInfo(VIEW)),
		visible: true,
	});
});

test("compaction_graph passes the bar through verbatim and honors the graph toggles", () => {
	const both = SEGMENTS.compaction_graph.render(ctxWith(VIEW));
	assert.ok(both.visible && both.content.startsWith(BAR), "bar first, untouched");
	assert.equal(stripAnsi(both.content), `${"▋".repeat(7)}${"░".repeat(13)} 86K/131K (66%)`);

	const barOnly = ctxWith(VIEW);
	barOnly.options = resolveEffectiveSettings({ segments: { contextStats: false } }).segmentOptions;
	assert.equal(SEGMENTS.compaction_graph.render(barOnly).content, BAR);

	const statsOnly = ctxWith(VIEW);
	statsOnly.options = resolveEffectiveSettings({ segments: { contextBar: false } }).segmentOptions;
	assert.equal(stripAnsi(SEGMENTS.compaction_graph.render(statsOnly).content), "86K/131K (66%)");

	const neither = ctxWith(VIEW);
	neither.options = resolveEffectiveSettings({ segments: { contextBar: false, contextStats: false } }).segmentOptions;
	assert.equal(SEGMENTS.compaction_graph.render(neither).visible, false);
});

test("the bottom bar swaps pi's stats and the context graph for the compaction while hosted", () => {
	const groups = (compacting: boolean) => ({
		left: EFFECTIVE.bottomLeftSegments,
		right: bottomRightSegments(EFFECTIVE, compacting),
	});
	const idle = stripAnsi(buildStatusLine(100, ctxWith(undefined), EFFECTIVE, noGap, groups(false)));
	assert.ok(idle.includes("↑ 142K"), "pi stats show while idle");
	assert.ok(idle.includes("41.0%/131K"), "the context label shows while idle");

	const bar = buildStatusLine(100, ctxWith(VIEW), EFFECTIVE, noGap, groups(true));
	const plain = stripAnsi(bar);
	assert.equal(visibleWidth(bar), 100);
	assert.ok(plain.includes(`47% summarized${DOT}16.3s`), "the compaction figures replace pi stats");
	assert.ok(plain.includes(`${"▋".repeat(7)}${"░".repeat(13)} 86K/131K (66%)`), "the compaction bar replaces the graph");
	assert.ok(!plain.includes("↑ 142K"), "pi stats are gone");
	assert.ok(!plain.includes("41.0%"), "the context label is gone");
	assert.ok(bar.includes(BAR), "the bar's own colors survive the layout");
});

test("onFit reports which segments actually survived overflow trimming, not just what was requested", () => {
	const groups = { left: [], right: bottomRightSegments(EFFECTIVE, true) };
	let wide: { left: readonly string[]; right: readonly string[] } | undefined;
	buildStatusLine(100, ctxWith(VIEW), EFFECTIVE, noGap, groups, undefined, {
		onFit: fit => {
			wide = fit;
		},
	});
	assert.deepEqual(wide?.right, ["compaction_info", "compaction_graph"], "both stand-ins fit at full width");

	let narrow: { left: readonly string[]; right: readonly string[] } | undefined;
	buildStatusLine(20, ctxWith(VIEW), EFFECTIVE, noGap, groups, undefined, {
		onFit: fit => {
			narrow = fit;
		},
	});
	assert.ok(
		!narrow?.right.includes("compaction_info") && !narrow?.right.includes("compaction_graph"),
		"too narrow for either stand-in, so a caller checking onFit knows not to claim it hosts the progress",
	);
});
