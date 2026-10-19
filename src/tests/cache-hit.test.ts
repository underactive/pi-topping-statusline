import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	CACHE_HIT_DEFAULT_CELLS,
	CACHE_HIT_MAX_CELLS,
	CACHE_HIT_MIN_CELLS,
	clampCacheHitCells,
	getCacheHitGraphCells,
	getCacheHitPercent,
	getCacheHitThresholds,
	parseCacheHitStat,
	renderCacheHitGraph,
	stripCacheHitStat,
} from "../cache-hit.ts";
import { SegmentContextBuilder } from "../context.ts";
import { stripAnsi } from "../footer.ts";
import { buildStatusLine } from "../layout.ts";
import { SEGMENTS } from "../segments.ts";
import { resolveEffectiveSettings } from "../settings.ts";
import { buildSections, valuesToSettings } from "../settings-menu.ts";
import { theme } from "../theme.ts";
import type { SegmentContext } from "../types.ts";

const usage = (input: number, cacheRead: number, cacheWrite = 0) => ({
	input,
	output: 0,
	cacheRead,
	cacheWrite,
	totalTokens: input + cacheRead + cacheWrite,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

const entry = (value: unknown): SessionEntry => value as SessionEntry;

test("the fallback rate is pi's CH: the latest assistant response only", () => {
	const entries = [
		entry({ type: "message", message: { role: "assistant", usage: usage(80, 20) } }),
		entry({ type: "message", message: { role: "assistant", usage: usage(6, 990, 4) } }),
		entry({ type: "usage", usage: usage(500, 0) }),
		entry({ type: "compaction", usage: usage(500, 0) }),
	];
	assert.equal(getCacheHitPercent(entries), 99);
});

test("the fallback rate stays absent before an assistant reports prompt tokens", () => {
	assert.equal(getCacheHitPercent([entry({ type: "usage", usage: usage(10, 90) })]), null);
	assert.equal(getCacheHitPercent([entry({ type: "message", message: { role: "assistant", usage: usage(0, 0) } })]), null);
});

test("pi's CH stat is parsed from its stats line", () => {
	assert.equal(parseCacheHitStat("↑1.2M ↓48K R6.1M W120K CH99.4% $2.357"), 99.4);
	assert.equal(parseCacheHitStat("↑1.2M ↓48K $2.357"), null);
	assert.equal(parseCacheHitStat(undefined), null);
});

test("99.1% fills four cells and 99.4% fills all five at five segments", () => {
	assert.equal(getCacheHitGraphCells(99.1, 5), 4);
	assert.equal(getCacheHitGraphCells(99.4, 5), 5);
});

test("the Cache hit bar toggle controls a standalone segment", () => {
	const on = resolveEffectiveSettings({});
	assert.equal(on.includes.cacheHit, true);
	assert.ok(on.bottomRightSegments.includes("cache_hit_graph"));

	const off = resolveEffectiveSettings({ segments: { cacheHitBar: false } });
	assert.equal(off.includes.cacheHit, false);
	assert.equal(off.segmentOptions.context.showBar, true);
	assert.ok(!off.bottomRightSegments.includes("cache_hit_graph"));

	const cacheOnly = resolveEffectiveSettings({ segments: { piStats: false, contextBar: false, contextStats: false } });
	assert.deepEqual(cacheOnly.bottomRightSegments.slice(-1), ["cache_hit_graph"]);
});

test("the cache graph owns its CH label", () => {
	const options = resolveEffectiveSettings({}).segmentOptions;
	const result = SEGMENTS.cache_hit_graph.render({ options, cacheHitPercent: 100 } as SegmentContext);
	assert.equal(stripAnsi(result.content), `${"▋".repeat(4)} CH100.0%`);
	assert.equal(SEGMENTS.cache_hit_graph.render({ options, cacheHitPercent: null } as SegmentContext).visible, false);
});

test("the cache graph is as long as the CH bar segments setting", () => {
	for (const cells of [4, 7, 10]) {
		const options = resolveEffectiveSettings({ cacheHitBarSegments: cells }).segmentOptions;
		const result = SEGMENTS.cache_hit_graph.render({ options, cacheHitPercent: 100 } as SegmentContext);
		assert.equal(stripAnsi(result.content), `${"▋".repeat(cells)} CH100.0%`);
	}
});

test("the builder prefers pi's CH stat and falls back to the derived rate", () => {
	const effective = resolveEffectiveSettings({});
	const fakePi = { exec: async () => undefined, getThinkingLevel: () => "off" } as unknown as ExtensionAPI;
	const entries = [entry({ type: "message", message: { role: "assistant", usage: usage(50, 50) } })];
	const ctx = {
		cwd: "/tmp/pi-topping-statusline-tests",
		model: undefined,
		getContextUsage: () => undefined,
		sessionManager: { getSessionName: () => undefined, getEntries: () => entries },
	} as unknown as ExtensionContext;
	const include = { ...effective.includes, git: false, pr: false, piStats: true, feeds: [] };

	let stats: string | undefined = "↑1.2M CH99.4% $2.357";
	const builder = new SegmentContextBuilder(fakePi);
	builder.setPiStatsProvider(() => stats);
	builder.attach(ctx);
	const fromStats = builder.build(80, effective.segmentOptions, include, undefined);
	assert.equal(fromStats.cacheHitPercent, 99.4);
	assert.equal(fromStats.piStats, "↑1.2M $2.357", "CH moves beside its graph");

	stats = undefined;
	const fallback = new SegmentContextBuilder(fakePi);
	fallback.setPiStatsProvider(() => stats);
	fallback.attach(ctx);
	assert.equal(fallback.build(80, effective.segmentOptions, include, undefined).cacheHitPercent, 50);
	builder.dispose();
	fallback.dispose();
});

test("the builder does not derive a CH rate when pi's stats line omits it", () => {
	const effective = resolveEffectiveSettings({});
	const fakePi = { exec: async () => undefined, getThinkingLevel: () => "off" } as unknown as ExtensionAPI;
	const entries = [entry({ type: "message", message: { role: "assistant", usage: usage(100, 0) } })];
	const ctx = {
		cwd: "/tmp/pi-topping-statusline-tests",
		model: undefined,
		getContextUsage: () => undefined,
		sessionManager: { getSessionName: () => undefined, getEntries: () => entries },
	} as unknown as ExtensionContext;
	const include = { ...effective.includes, git: false, pr: false, piStats: true, feeds: [] };
	const builder = new SegmentContextBuilder(fakePi);
	builder.setPiStatsProvider(() => "↑1.2M ↓48K $2.357");
	builder.attach(ctx);
	assert.equal(builder.build(80, effective.segmentOptions, include, undefined).cacheHitPercent, null);
	builder.dispose();
});

test("only 0% is empty; after 50% each cell quarters the remaining miss rate", () => {
	assert.equal(getCacheHitGraphCells(0, 5), 0);
	assert.equal(getCacheHitGraphCells(0.1, 5), 1);
	assert.equal(getCacheHitGraphCells(49.9, 5), 1);
	assert.equal(getCacheHitGraphCells(50, 5), 2);
	assert.equal(getCacheHitGraphCells(87.4, 5), 2);
	assert.equal(getCacheHitGraphCells(87.5, 5), 3);
	assert.equal(getCacheHitGraphCells(96.875, 5), 4);
	assert.equal(getCacheHitGraphCells(99.21875, 5), 5);
	assert.equal(getCacheHitGraphCells(100, 5), 5);
	assert.equal(getCacheHitGraphCells(Number.NaN, 5), 0);
});

test("the rendered bar is five cells wide at five segments", () => {
	assert.equal(stripAnsi(renderCacheHitGraph(0, 5)), "░".repeat(5));
	assert.equal(stripAnsi(renderCacheHitGraph(10, 5)), `▋${"░".repeat(4)}`);
	assert.equal(stripAnsi(renderCacheHitGraph(50, 5)), `${"▋".repeat(2)}${"░".repeat(3)}`);
});

test("the entire filled bar uses its current hit-rate color", () => {
	assert.ok(renderCacheHitGraph(10).includes(theme.getFgAnsi("error")));

	const sixty = renderCacheHitGraph(60);
	assert.ok(sixty.includes(theme.getFgAnsi("statusLineContextElevated")));
	assert.ok(!sixty.includes(theme.getFgAnsi("error")));

	const ninetyFive = renderCacheHitGraph(95);
	assert.ok(ninetyFive.includes(theme.getFgAnsi("warning")));
	assert.ok(!ninetyFive.includes(theme.getFgAnsi("error")));
	assert.ok(!ninetyFive.includes(theme.getFgAnsi("statusLineContextElevated")));

	assert.ok(renderCacheHitGraph(99.1).includes(theme.getFgAnsi("statusLineCacheHit")));

	const perfect = renderCacheHitGraph(100);
	assert.equal(stripAnsi(perfect), "▋".repeat(4));
	assert.ok(perfect.includes(theme.getFgAnsi("statusLineCacheHit")));
	assert.ok(!perfect.includes(theme.getFgAnsi("warning")));
});

test("cache hit stat stripping preserves the other footer figures", () => {
	assert.equal(stripCacheHitStat("↑425k ↓40k R11M W328k CH99.1% $5.091"), "↑425k ↓40k R11M W328k $5.091");
	assert.equal(stripCacheHitStat("↑425k $5.091"), "↑425k $5.091");
});

test("the bottom bar groups Pi stats, the CH graph and context graph separately", () => {
	const effective = resolveEffectiveSettings({ transparent: true, separator: "powerline-thin", cacheHitBarSegments: 5 });
	const ctx = {
		options: effective.segmentOptions,
		model: undefined,
		thinkingLevel: "off",
		cwd: "/tmp",
		sessionName: undefined,
		contextPercent: 17.8,
		contextTokens: 178_000,
		contextWindow: 1_000_000,
		cacheHitPercent: 99.1,
		git: { branch: null, status: null, pr: null },
		worktree: null,
		scrollHint: undefined,
		piStats: "↑425k ↓40k R11M W328k $5.091",
		tokenRate: undefined,
		feedData: undefined,
	} satisfies SegmentContext;
	const bar = buildStatusLine(0, ctx, effective, text => text, { left: [], right: effective.bottomRightSegments });
	assert.equal(
		stripAnsi(bar),
		` ↑425k ↓40k R11M W328k $5.091  ${"▋".repeat(4)}░ CH99.1%  ${"▋".repeat(4)}${"░".repeat(16)} 17.8%/1.0M `,
	);

	let fittedRight: readonly string[] = [];
	const narrowBar = buildStatusLine(
		50,
		ctx,
		effective,
		text => text,
		{ left: [], right: effective.bottomRightSegments },
		undefined,
		{ onFit: fit => { fittedRight = fit.right; } },
	);
	assert.deepEqual(fittedRight, ["pi_stats", "cache_hit_graph"]);
	assert.ok(stripAnsi(narrowBar).includes("CH99.1%"));
});

test("the 5-segment scale is the quartering scale: 50, 87.5, 96.875, 99.21875", () => {
	assert.deepEqual(getCacheHitThresholds(5), [50, 87.5, 96.875, 99.21875]);
	assert.deepEqual(getCacheHitThresholds(4), [50, 93.75, 99.21875]);
});

test("every bar size is logarithmic, from 50% at the second cell to 99.21875% at the last", () => {
	for (let cells = CACHE_HIT_MIN_CELLS; cells <= CACHE_HIT_MAX_CELLS; cells++) {
		const thresholds = getCacheHitThresholds(cells);
		assert.equal(thresholds.length, cells - 1, `${cells} cells: one threshold per cell after the first`);
		assert.equal(thresholds[0], 50);
		assert.equal(thresholds.at(-1), 99.21875);
		const misses = thresholds.map(t => 100 - t);
		for (let i = 1; i < misses.length; i++) {
			assert.ok(misses[i]! < misses[i - 1]!, `${cells} cells: thresholds strictly increase`);
		}
		// A log scale shrinks the miss rate by the same factor from cell to cell.
		const ratios = misses.slice(1).map((miss, i) => miss / misses[i]!);
		for (const ratio of ratios) assert.ok(Math.abs(ratio - ratios[0]!) < 1e-4, `${cells} cells: constant ratio ${ratios}`);
	}
});

test("every bar size keeps the rules: 0% is empty, anything above fills a cell, 100% is full", () => {
	for (let cells = CACHE_HIT_MIN_CELLS; cells <= CACHE_HIT_MAX_CELLS; cells++) {
		assert.equal(getCacheHitGraphCells(0, cells), 0);
		assert.equal(getCacheHitGraphCells(0.01, cells), 1);
		assert.equal(getCacheHitGraphCells(49.9, cells), 1);
		assert.equal(getCacheHitGraphCells(50, cells), 2);
		assert.equal(getCacheHitGraphCells(100, cells), cells);
		let previous = 0;
		for (const percent of [1, 20, 50, 70, 90, 95, 98, 99, 99.5, 100]) {
			const filled = getCacheHitGraphCells(percent, cells);
			assert.ok(filled >= previous && filled <= cells, `${cells} cells at ${percent}%: ${filled}`);
			previous = filled;
		}
		assert.equal(stripAnsi(renderCacheHitGraph(0, cells)), "░".repeat(cells));
		assert.equal(stripAnsi(renderCacheHitGraph(100, cells)), "▋".repeat(cells));
	}
});

test("more segments resolve finer near 100%", () => {
	assert.equal(getCacheHitGraphCells(99.1, 3), 2);
	assert.equal(getCacheHitGraphCells(99.4, 3), 3);
	assert.equal(getCacheHitGraphCells(99.1, 4), 3);
	assert.equal(getCacheHitGraphCells(99.1, 5), 4);
	assert.equal(getCacheHitGraphCells(99.1, 10), 9, "98.69% is the ninth cell's threshold; the tenth needs 99.22%");
	assert.equal(getCacheHitGraphCells(99.4, 10), 10);
});

test("a hit rate keeps its color at every bar size", () => {
	for (const percent of [10, 60, 95, 99.1]) {
		const colors = new Set<string>();
		for (let cells = CACHE_HIT_MIN_CELLS; cells <= CACHE_HIT_MAX_CELLS; cells++) {
			colors.add(renderCacheHitGraph(percent, cells).match(/^\x1b\[[\d;]+m/)![0]);
		}
		assert.equal(colors.size, 1, `${percent}% should be one color across sizes`);
	}
});

test("the bar size is clamped to 3–10, with 4 for anything unusable", () => {
	assert.equal(CACHE_HIT_DEFAULT_CELLS, 4);
	assert.equal(clampCacheHitCells(2), 3);
	assert.equal(clampCacheHitCells(3), 3);
	assert.equal(clampCacheHitCells(11), 10);
	assert.equal(clampCacheHitCells(6.4), 6);
	assert.equal(clampCacheHitCells(Number.NaN), 4);
	assert.equal(clampCacheHitCells(Number.POSITIVE_INFINITY), 4);
	assert.equal(clampCacheHitCells("7"), 4);
	assert.equal(clampCacheHitCells(undefined), 4);
	assert.equal(renderCacheHitGraph(100, 99).length, renderCacheHitGraph(100, 10).length, "a bad size renders as the clamped size");
});

test("the CH bar segments setting resolves to the segment options, default 4", () => {
	assert.equal(resolveEffectiveSettings({}).segmentOptions.cacheHit.cells, 4);
	assert.equal(resolveEffectiveSettings({ cacheHitBarSegments: 8 }).segmentOptions.cacheHit.cells, 8);
	assert.equal(resolveEffectiveSettings({ cacheHitBarSegments: 2 }).segmentOptions.cacheHit.cells, 3);
	assert.equal(resolveEffectiveSettings({ cacheHitBarSegments: 40 }).segmentOptions.cacheHit.cells, 10);
});

test("the settings menu offers CH bar segments 3–10 under the Cache hit bar toggle and reads the choice back", () => {
	const items = buildSections({}).flatMap(section => section.items);
	const toggle = items.findIndex(item => item.id === "cacheHitBar");
	const row = items[toggle + 1]!;
	assert.equal(row.kind, "cycle");
	if (row.kind !== "cycle") return;
	assert.equal(row.id, "cacheHitBarSegments");
	assert.equal(row.label, "CH bar segments");
	assert.equal(row.value, "4", "defaults to 4");
	assert.deepEqual(row.values, ["3", "4", "5", "6", "7", "8", "9", "10"]);

	const saved = buildSections({ cacheHitBarSegments: 9 }).flatMap(section => section.items);
	const savedRow = saved.find(item => item.id === "cacheHitBarSegments");
	assert.equal(savedRow?.kind === "cycle" && savedRow.value, "9", "shows the saved size");

	// Action rows hold no value, so only value-bearing rows seed the draft.
	const values = Object.fromEntries(saved.flatMap(item => ("value" in item ? [[item.id, item.value]] : [])));
	assert.equal(valuesToSettings({ ...values, cacheHitBarSegments: "7" }).cacheHitBarSegments, 7);
	assert.equal(valuesToSettings({ ...values, cacheHitBarSegments: "garbage" }).cacheHitBarSegments, 4);
});
