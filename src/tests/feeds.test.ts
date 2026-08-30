/**
 * Contracts for the feeds segment, which surfaces values other extensions
 * publish as custom session entries. The default subscription targets
 * pi-prompt-cache's savings feed, whose author specified the currency rules.
 *
 * Ordering matters here: a publisher emits at turn end or after compaction,
 * both of which require a completed model call, so a live entry is always
 * written after the consumer's session_start. Fabricating a timestamp before
 * attaching would exercise an ordering the real system cannot produce, and the
 * stale-run guard would discard it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { renderBoxRowIfVisible } from "../box.ts";
import { SegmentContextBuilder } from "../context.ts";
import { buildStatusLine } from "../layout.ts";
import { SEGMENTS } from "../segments.ts";
import { DEFAULT_FEEDS, DEFAULT_SEGMENTS, resolveEffectiveSettings, sanitizeFeeds } from "../settings.ts";
import type { SegmentContext, StatusLineFeed } from "../types.ts";

const SAVINGS = "pi-prompt-cache/savings";
const OPTIONS = resolveEffectiveSettings({}).segmentOptions;
const INCLUDE = { git: false, pr: false, piStats: false, tokenRate: false, feeds: [SAVINGS] };
/** Outside any repo, so the builder's git probes stay inert. */
const CWD = "/tmp/pi-topping-statusline-tests";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

// Partial stand-ins: the builder only reaches the members defined here.
const fakePi = { exec: async () => undefined, getThinkingLevel: () => "off" } as unknown as ExtensionAPI;
const fakeCtx = (entries: SessionEntry[], onScan?: () => void): ExtensionContext =>
	({
		cwd: CWD,
		sessionManager: {
			getEntries: () => {
				onScan?.();
				return entries;
			},
			getSessionName: () => undefined,
		},
		getContextUsage: () => undefined,
		model: undefined,
	}) as unknown as ExtensionContext;

const feedEntry = (data: unknown, customType = SAVINGS, timestamp = new Date().toISOString()): SessionEntry =>
	({ type: "custom", customType, id: "e", parentId: null, timestamp, data }) as SessionEntry;

/** Attach first, let the clock advance, then emit — a publisher's real ordering. */
async function contextAfterEmitting(
	makeEntries: () => SessionEntry[],
	include = INCLUDE,
): Promise<SegmentContext> {
	const entries: SessionEntry[] = [];
	const builder = new SegmentContextBuilder(fakePi);
	builder.attach(fakeCtx(entries));
	await sleep(3);
	entries.push(...makeEntries());
	return builder.build(80, OPTIONS, include, undefined);
}

const BASE = await contextAfterEmitting(() => []);
/** Render the segment against explicit feed config and payloads. */
const renderFeeds = (feeds: StatusLineFeed[], feedData: Record<string, unknown> | undefined) =>
	SEGMENTS.feeds.render({ ...BASE, options: { ...BASE.options, feeds }, feedData });
const savingsFeed = (format: StatusLineFeed["format"] = "currency", prefix = "CS"): StatusLineFeed => ({
	customType: SAVINGS,
	field: "savedUsd",
	prefix,
	format,
});
const renderSaved = (value: unknown, format: StatusLineFeed["format"] = "currency") =>
	renderFeeds([savingsFeed(format)], { [SAVINGS]: { savedUsd: value } });

const FOOTER_PAINTERS = {
	paint: (_row: number, _col: number, ch: string) => ch,
	horizRun: (_row: number, _startCol: number, count: number) => "─".repeat(count),
	gapColor: (str: string, _startCol: number, _row: number) => str,
};

/** Build the same one-row bottom-bar path used by index.ts for feed-only cases. */
const renderFeedRows = (feedData: Record<string, unknown> | undefined, format: StatusLineFeed["format"] = "currency") => {
	const feed = savingsFeed(format);
	const settings = resolveEffectiveSettings({ feeds: [feed] });
	const ctx: SegmentContext = { ...BASE, options: settings.segmentOptions, feedData };
	const bar = buildStatusLine(74, ctx, settings, (str, _startCol, _row) => str, { left: [], right: ["feeds"] });
	return renderBoxRowIfVisible(FOOTER_PAINTERS, bar, 2, 80, "╰", "╯");
};

// ── reading the feed ───────────────────────────────────────────────────────

test("hidden when no publisher has emitted", async () => {
	const ctx = await contextAfterEmitting(() => []);
	assert.deepEqual(ctx.feedData, {});
	assert.equal(SEGMENTS.feeds.render(ctx).visible, false);
});

test("configured but unavailable or empty feeds reserve no footer row", () => {
	assert.equal(renderFeedRows(undefined).length, 0);
	assert.equal(renderFeedRows({}).length, 0);
	assert.equal(renderFeedRows({ [SAVINGS]: {} }).length, 0);
});

test("a visible feed keeps the footer row", () => {
	assert.equal(renderFeedRows({ [SAVINGS]: { savedUsd: 1.25 } }).length, 1);
});

test("a later custom_message sharing the customType cannot shadow a real entry", async () => {
	// CustomMessageEntry carries customType too, but keeps its payload under
	// details. Matching on customType alone would hit this newer entry first,
	// find nothing usable, and suppress the real value behind it.
	const decoy = {
		type: "custom_message",
		customType: SAVINGS,
		id: "m",
		parentId: null,
		timestamp: new Date().toISOString(),
		content: "x",
		display: false,
		details: { savedUsd: 99 },
	} as SessionEntry;
	const ctx = await contextAfterEmitting(() => [feedEntry({ savedUsd: 4.2 }), decoy]);
	assert.deepEqual(ctx.feedData, { [SAVINGS]: { savedUsd: 4.2 } });
});

test("unsubscribed customTypes are ignored", async () => {
	const ctx = await contextAfterEmitting(() => [feedEntry({ savedUsd: 9 }, "other-ext/thing")]);
	assert.deepEqual(ctx.feedData, {});
});

test("the newest matching entry wins", async () => {
	const ctx = await contextAfterEmitting(() => [feedEntry({ savedUsd: 0.5 }), feedEntry({ savedUsd: 1.2345 })]);
	assert.deepEqual(ctx.feedData, { [SAVINGS]: { savedUsd: 1.2345 } });
});

test("several feeds are collected in one pass and render together", async () => {
	const include = { ...INCLUDE, feeds: [SAVINGS, "my-ext/tokens"] };
	const ctx = await contextAfterEmitting(
		() => [feedEntry({ savedUsd: 1.5 }), feedEntry({ count: 42 }, "my-ext/tokens")],
		include,
	);
	const feeds: StatusLineFeed[] = [
		savingsFeed(),
		{ customType: "my-ext/tokens", field: "count", prefix: "TOK ", format: "number" },
	];
	assert.equal(stripAnsi(renderFeeds(feeds, ctx.feedData).content), "CS$1.50 TOK 42");
});

test("a subscribed feed with no publisher simply contributes nothing", async () => {
	const include = { ...INCLUDE, feeds: [SAVINGS, "absent/feed"] };
	const ctx = await contextAfterEmitting(() => [feedEntry({ savedUsd: 2 })], include);
	const feeds: StatusLineFeed[] = [
		savingsFeed(),
		{ customType: "absent/feed", field: "x", prefix: "AB", format: "number" },
	];
	assert.equal(stripAnsi(renderFeeds(feeds, ctx.feedData).content), "CS$2.00");
});

test("missing fields and malformed payloads do not surface", () => {
	assert.equal(renderSaved("1.23").visible, false, "a string is not a currency value");
	assert.equal(renderSaved(Number.NaN).visible, false);
	assert.equal(renderSaved(undefined).visible, false);
	assert.equal(renderFeeds([savingsFeed()], { [SAVINGS]: { other: 1 } }).visible, false);
	assert.equal(renderFeeds([savingsFeed()], { [SAVINGS]: 5 }).visible, false, "payload must be an object");
});

// ── the per-run reset ──────────────────────────────────────────────────────

test("entries predating this run are stale and render nothing", async () => {
	const priorRun = new Date(Date.now() - 60_000).toISOString();
	const ctx = await contextAfterEmitting(() => [feedEntry({ savedUsd: 7.77 }, SAVINGS, priorRun)]);
	assert.deepEqual(ctx.feedData, {}, "a prior run's figure must not surface");
});

test("the first emission of the new run supersedes a stale one", async () => {
	const priorRun = new Date(Date.now() - 60_000).toISOString();
	const ctx = await contextAfterEmitting(() => [
		feedEntry({ savedUsd: 7.77 }, SAVINGS, priorRun),
		feedEntry({ savedUsd: 0.42 }),
	]);
	assert.deepEqual(ctx.feedData, { [SAVINGS]: { savedUsd: 0.42 } });
});

test("session replacement inside the TTL window drops the cached payload", async () => {
	const entries: SessionEntry[] = [];
	const builder = new SegmentContextBuilder(fakePi);

	builder.attach(fakeCtx(entries));
	await sleep(3);
	entries.push(feedEntry({ savedUsd: 4.2 }));
	assert.deepEqual(builder.build(80, OPTIONS, INCLUDE, undefined).feedData, { [SAVINGS]: { savedUsd: 4.2 } });

	// /new, /resume and /fork replace the session in-process; publishers reset,
	// so the entries above now belong to a previous run.
	await sleep(3);
	builder.attach(fakeCtx(entries));
	assert.deepEqual(
		builder.build(80, OPTIONS, INCLUDE, undefined).feedData,
		{},
		"must rescan on attach rather than serve the prior session's payload",
	);
});

test("no stale frame is observable across the whole TTL window", async () => {
	const entries: SessionEntry[] = [];
	const builder = new SegmentContextBuilder(fakePi);
	builder.attach(fakeCtx(entries));
	await sleep(3);
	entries.push(feedEntry({ savedUsd: 9.99 }));
	builder.build(80, OPTIONS, INCLUDE, undefined);

	await sleep(3);
	builder.attach(fakeCtx(entries));
	for (let frame = 0; frame < 10; frame++) {
		assert.deepEqual(builder.build(80, OPTIONS, INCLUDE, undefined).feedData, {}, `frame ${frame} leaked`);
		await sleep(30);
	}
});

// ── scan cost ──────────────────────────────────────────────────────────────

test("no subscriptions means the session is never read", () => {
	let scans = 0;
	const builder = new SegmentContextBuilder(fakePi);
	builder.attach(fakeCtx([feedEntry({ savedUsd: 1 })], () => scans++));
	const ctx = builder.build(80, OPTIONS, { ...INCLUDE, feeds: [] }, undefined);
	assert.equal(scans, 0);
	assert.equal(ctx.feedData, undefined);
});

test("renders share one scan per TTL, and attach forces a fresh one", async () => {
	let scans = 0;
	const entries: SessionEntry[] = [];
	const builder = new SegmentContextBuilder(fakePi);
	builder.attach(fakeCtx(entries, () => scans++));
	await sleep(3);
	entries.push(feedEntry({ savedUsd: 1.5 }));

	for (let i = 0; i < 50; i++) builder.build(80, OPTIONS, INCLUDE, undefined);
	assert.equal(scans, 1, `expected 1 scan across 50 renders, got ${scans}`);

	builder.attach(fakeCtx(entries, () => scans++));
	builder.build(80, OPTIONS, INCLUDE, undefined);
	assert.equal(scans, 2, "attach must expire the cache rather than wait out the TTL");
});

test("changing the subscription list rescans without waiting out the TTL", async () => {
	let scans = 0;
	const entries: SessionEntry[] = [];
	const builder = new SegmentContextBuilder(fakePi);
	builder.attach(fakeCtx(entries, () => scans++));
	await sleep(3);
	entries.push(feedEntry({ savedUsd: 1 }), feedEntry({ count: 7 }, "my-ext/tokens"));

	builder.build(80, OPTIONS, INCLUDE, undefined);
	assert.equal(scans, 1);
	// Adding a feed in the settings menu must take effect on the next frame.
	const ctx = builder.build(80, OPTIONS, { ...INCLUDE, feeds: [SAVINGS, "my-ext/tokens"] }, undefined);
	assert.equal(scans, 2);
	assert.deepEqual(ctx.feedData, { [SAVINGS]: { savedUsd: 1 }, "my-ext/tokens": { count: 7 } });
});

test("a fresh emission appears once the TTL lapses", async () => {
	const entries: SessionEntry[] = [];
	const builder = new SegmentContextBuilder(fakePi);
	builder.attach(fakeCtx(entries));
	builder.build(80, OPTIONS, INCLUDE, undefined);

	await sleep(3);
	entries.push(feedEntry({ savedUsd: 0.01 }));
	assert.deepEqual(builder.build(80, OPTIONS, INCLUDE, undefined).feedData, {}, "still inside the TTL");
	await sleep(2_100);
	assert.deepEqual(builder.build(80, OPTIONS, INCLUDE, undefined).feedData, { [SAVINGS]: { savedUsd: 0.01 } });
});

// ── formats ────────────────────────────────────────────────────────────────

test("currency hides sub-cent and negative values, matching the publisher's own cutoff", () => {
	// A cold 100K-token prefix bills cacheWrite at 1.25x against a 1x baseline,
	// so the first turns really do publish a negative figure.
	for (const value of [-12.5, -0.03, -0.025, -0.005, -0.0001, 0, 0.002, 0.0049]) {
		assert.equal(renderSaved(value).visible, false, `${value} must be hidden`);
	}
	for (const value of [0.005, 0.0164, 1.235]) {
		assert.equal(renderSaved(value).visible, true, `${value} must show`);
	}
});

test("format-suppressed feed values reserve no footer row", () => {
	assert.equal(renderFeedRows({ [SAVINGS]: { savedUsd: 0.0049 } }).length, 0);
	assert.equal(renderFeedRows({ [SAVINGS]: { savedUsd: "" } }, "text").length, 0);
});

test("no $0.00 artifact is reachable near the crossing", () => {
	for (let value = -0.05; value <= 0.05; value += 0.0001) {
		assert.ok(!stripAnsi(renderSaved(value).content).includes("$0.00"), `rendered $0.00 at ${value}`);
	}
});

test("currency: two decimals below $100, whole dollars above", () => {
	assert.equal(stripAnsi(renderSaved(0.0164).content), "CS$0.02");
	assert.equal(stripAnsi(renderSaved(1.235).content), "CS$1.24");
	assert.equal(stripAnsi(renderSaved(99.994).content), "CS$99.99");
	assert.equal(stripAnsi(renderSaved(100).content), "CS$100");
	assert.equal(stripAnsi(renderSaved(1234.56).content), "CS$1235");
});

test("number prints plainly, keeping at most two decimals and no floor", () => {
	assert.equal(stripAnsi(renderSaved(87, "number").content), "CS87");
	assert.equal(stripAnsi(renderSaved(1.2345, "number").content), "CS1.23");
	assert.equal(stripAnsi(renderSaved(1.5, "number").content), "CS1.5");
	assert.equal(stripAnsi(renderSaved(-3, "number").content), "CS-3");
	assert.equal(stripAnsi(renderSaved(0, "number").content), "CS0", "number has no currency floor");
});

test("text prints any value as-is, sanitized", () => {
	assert.equal(stripAnsi(renderSaved("ready", "text").content), "CSready");
	assert.equal(stripAnsi(renderSaved(42, "text").content), "CS42");
	assert.equal(renderSaved("", "text").visible, false);
	assert.equal(stripAnsi(renderSaved("a\x1b[31mb", "text").content), "CSab", "escapes are stripped");
});

test("a prefix keeps deliberate spacing but never raw escapes", () => {
	const withSpace: StatusLineFeed = { customType: SAVINGS, field: "n", prefix: "TOK ", format: "number" };
	assert.equal(stripAnsi(renderFeeds([withSpace], { [SAVINGS]: { n: 42 } }).content), "TOK 42");
	const prefixed = (prefix: string) =>
		stripAnsi(renderFeeds([{ customType: SAVINGS, field: "n", prefix, format: "number" }], { [SAVINGS]: { n: 1 } }).content);
	assert.equal(prefixed("a\x1b[31mb"), "ab1", "colour escapes are removed, not rendered");
	assert.equal(prefixed("a\x07b"), "a b1", "control characters degrade to a space");
	assert.equal(prefixed("a\tb"), "a b1");
});

test("the prefix is literal, so the currency symbol can live in either place", () => {
	assert.equal(stripAnsi(renderFeeds([savingsFeed("currency", "CS")], { [SAVINGS]: { savedUsd: 1.44 } }).content), "CS$1.44");
	assert.equal(stripAnsi(renderFeeds([savingsFeed("number", "CS$")], { [SAVINGS]: { savedUsd: 1.44 } }).content), "CS$1.44");
	assert.equal(stripAnsi(renderFeeds([savingsFeed("currency", "")], { [SAVINGS]: { savedUsd: 1.44 } }).content), "$1.44");
});

// ── settings ───────────────────────────────────────────────────────────────

test("defaults: segment off, seeded with the pi-prompt-cache subscription", () => {
	assert.equal(DEFAULT_SEGMENTS.feeds, false);
	assert.ok(!resolveEffectiveSettings({}).bottomRightSegments.includes("feeds"));
	assert.deepEqual(resolveEffectiveSettings({}).segmentOptions.feeds, [
		{ customType: SAVINGS, field: "savedUsd", prefix: "CS", format: "currency" },
	]);
	assert.deepEqual(resolveEffectiveSettings({ segments: { feeds: true } }).bottomRightSegments, [
		"feeds",
		"pi_stats",
		"context_graph",
	]);
});

test("feeds lead the bottom-right group", () => {
	assert.deepEqual(
		resolveEffectiveSettings({ segments: { feeds: true, tokenRate: true } }).bottomRightSegments,
		["feeds", "token_rate", "pi_stats", "context_graph"],
	);
});

test("the bottom-left group runs scroll hint, feeds, then the rate", () => {
	assert.equal(DEFAULT_SEGMENTS.feedsBottomLeft, false);
	assert.deepEqual(resolveEffectiveSettings({}).bottomLeftSegments, ["scroll_hint"]);
	assert.deepEqual(
		resolveEffectiveSettings({ segments: { feedsBottomLeft: true, tokenRateBottomLeft: true } })
			.bottomLeftSegments,
		["scroll_hint", "feeds", "token_rate"],
	);
});

test("sanitizeFeeds drops unusable rows and normalizes the rest", () => {
	assert.deepEqual(
		sanitizeFeeds([
			{ customType: " a/b ", field: " f ", prefix: "P", format: "number" },
			{ customType: "", field: "f", prefix: "", format: "number" },
			{ customType: "c/d", field: "", prefix: "", format: "number" },
			{ customType: "e/f", field: "g", prefix: "", format: "bogus" },
			"nonsense",
			null,
		]),
		[
			{ customType: "a/b", field: "f", prefix: "P", format: "number" },
			{ customType: "e/f", field: "g", prefix: "", format: "text" },
		],
	);
	assert.deepEqual(sanitizeFeeds(undefined), []);
});

test("an explicitly empty feed list is honoured rather than reseeded", () => {
	assert.deepEqual(resolveEffectiveSettings({ feeds: [] }).segmentOptions.feeds, []);
});

test("the default subscription matches what pi-prompt-cache publishes", () => {
	assert.equal(DEFAULT_FEEDS[0]?.customType, SAVINGS);
	assert.equal(DEFAULT_FEEDS[0]?.field, "savedUsd");
	assert.equal(DEFAULT_FEEDS[0]?.format, "currency");
});
