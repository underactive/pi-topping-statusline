/**
 * The context graph between a compaction and the next response. pi reports
 * usage as unknown for that stretch; the builder fills it with pi's own
 * estimate of the compacted context, the figure pi hands compaction callers as
 * estimatedTokensAfter, so the graph never vanishes and agrees with the result
 * pi-topping-compact reports.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
	buildSessionContext,
	estimateTokens,
	type ExtensionAPI,
	type ExtensionContext,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { SegmentContextBuilder, estimateCompactedContextTokens } from "../context.ts";
import { stripAnsi } from "../footer.ts";
import { SEGMENTS } from "../segments.ts";
import { resolveEffectiveSettings } from "../settings.ts";
import type { SegmentContext } from "../types.ts";

const WINDOW = 131_072;
const OPTIONS = resolveEffectiveSettings({}).segmentOptions;
const INCLUDE = { git: false, pr: false, piStats: false, tokenRate: false, feeds: [] };
/** Outside any repo, so the builder's git probes stay inert. */
const CWD = "/tmp/pi-topping-statusline-tests";
const fakePi = { exec: async () => undefined, getThinkingLevel: () => "off" } as unknown as ExtensionAPI;

type Usage = { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
const UNKNOWN: Usage = { tokens: null, contextWindow: WINDOW, percent: null };

const EPOCH = 1_700_000_000_000;
const at = (i: number) => new Date(EPOCH + i * 1000).toISOString();
const user = (id: string, parentId: string | null, text: string, i: number): SessionEntry =>
	({
		type: "message",
		id,
		parentId,
		timestamp: at(i),
		message: { role: "user", content: text, timestamp: EPOCH + i * 1000 },
	}) as unknown as SessionEntry;
const assistant = (id: string, parentId: string, text: string, i: number): SessionEntry =>
	({
		type: "message",
		id,
		parentId,
		timestamp: at(i),
		message: {
			role: "assistant",
			content: [{ type: "text", text }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "m",
			usage: { input: 80_000, output: 500, cacheRead: 0, cacheWrite: 0, totalTokens: 80_500 },
			stopReason: "stop",
			timestamp: EPOCH + i * 1000,
		},
	}) as unknown as SessionEntry;

/** A branch just after compaction: the first exchange summarized, the second kept, the leaf on the compaction. */
function compactedBranch(): SessionEntry[] {
	return [
		user("e1", null, "Please review the repository layout.", 1),
		assistant("e2", "e1", "x".repeat(60_000), 2),
		user("e3", "e2", "Now write the tests.", 3),
		assistant("e4", "e3", "Done, all pass.", 4),
		{
			type: "compaction",
			id: "e5",
			parentId: "e4",
			timestamp: at(5),
			summary: "The layout was reviewed. ".repeat(80),
			firstKeptEntryId: "e3",
			tokensBefore: 86_000,
		} as unknown as SessionEntry,
	];
}

function fakeCtx(branch: SessionEntry[], usage: Usage, counters = { branch: 0 }): ExtensionContext {
	return {
		cwd: CWD,
		model: { id: "m", provider: "anthropic", name: "M", contextWindow: WINDOW },
		getContextUsage: () => usage,
		sessionManager: {
			getSessionId: () => "session-1",
			getSessionName: () => undefined,
			getLeafId: () => branch.at(-1)?.id ?? null,
			getBranch: () => {
				counters.branch++;
				return [...branch];
			},
			getEntries: () => branch,
		},
	} as unknown as ExtensionContext;
}

/** What pi itself computes as estimatedTokensAfter for this branch. */
function piEstimate(branch: SessionEntry[]): number {
	let tokens = 0;
	for (const message of buildSessionContext(branch, branch.at(-1)?.id).messages) tokens += estimateTokens(message);
	return tokens;
}

function segmentCtx(overrides: Partial<SegmentContext>): SegmentContext {
	return {
		options: OPTIONS,
		model: undefined,
		thinkingLevel: "off",
		cwd: CWD,
		sessionName: undefined,
		contextPercent: null,
		contextTokens: 0,
		contextWindow: WINDOW,
		git: { branch: null, status: null, pr: null },
		worktree: null,
		scrollHint: undefined,
		piStats: undefined,
		tokenRate: undefined,
		feedData: undefined,
		...overrides,
	};
}

test("after a compaction the builder sizes the context as pi does, leaving out what was summarized", () => {
	const branch = compactedBranch();
	const builder = new SegmentContextBuilder(fakePi);
	builder.attach(fakeCtx(branch, UNKNOWN));
	const ctx = builder.build(80, OPTIONS, INCLUDE, undefined);

	const expected = piEstimate(branch);
	assert.equal(ctx.contextTokens, expected);
	assert.equal(ctx.contextPercent, (expected / WINDOW) * 100);
	assert.equal(ctx.contextEstimated, true);
	assert.equal(ctx.contextWindow, WINDOW);
	assert.ok(expected > 0);
	const summarized = branch[1] as SessionEntry & { message: Parameters<typeof estimateTokens>[0] };
	assert.ok(expected < estimateTokens(summarized.message), "the summarized reply no longer counts");
});

test("the estimate is cached per leaf and rebuilt when the branch grows", () => {
	const branch = compactedBranch();
	const counters = { branch: 0 };
	const builder = new SegmentContextBuilder(fakePi);
	builder.attach(fakeCtx(branch, UNKNOWN, counters));

	const first = builder.build(80, OPTIONS, INCLUDE, undefined);
	builder.build(80, OPTIONS, INCLUDE, undefined);
	assert.equal(counters.branch, 1, "the same leaf reuses the estimate");

	const followUp = user("e6", "e5", "And now the docs, please.", 6);
	branch.push(followUp);
	const grown = builder.build(80, OPTIONS, INCLUDE, undefined);
	assert.equal(counters.branch, 2, "a new leaf rebuilds it");
	const added = estimateTokens((followUp as SessionEntry & { message: Parameters<typeof estimateTokens>[0] }).message);
	assert.equal(grown.contextTokens, first.contextTokens + added);
	assert.equal(grown.contextTokens, piEstimate(branch));
});

test("pi's measured figure takes over as soon as it has one", () => {
	const counters = { branch: 0 };
	const builder = new SegmentContextBuilder(fakePi);
	builder.attach(fakeCtx(compactedBranch(), { tokens: 12_345, contextWindow: WINDOW, percent: 9.4 }, counters));
	const ctx = builder.build(80, OPTIONS, INCLUDE, undefined);
	assert.equal(ctx.contextTokens, 12_345);
	assert.equal(ctx.contextPercent, 9.4);
	assert.equal(ctx.contextEstimated, false);
	assert.equal(counters.branch, 0, "no estimate is computed");
});

test("a broken session manager costs the estimate, not the frame", () => {
	const builder = new SegmentContextBuilder(fakePi);
	const ctx = fakeCtx(compactedBranch(), UNKNOWN);
	(ctx as { sessionManager: Partial<ExtensionContext["sessionManager"]> }).sessionManager = {
		getSessionName: () => undefined,
		getEntries: () => [],
	};
	builder.attach(ctx);
	const built = builder.build(80, OPTIONS, INCLUDE, undefined);
	assert.equal(built.contextPercent, null);
	assert.equal(built.contextTokens, 0);
	assert.equal(built.contextEstimated, false);
});

test("an empty branch estimates zero", () => {
	assert.equal(
		estimateCompactedContextTokens({
			getBranch: () => [],
			getLeafId: () => null,
		} as unknown as ExtensionContext["sessionManager"]),
		0,
	);
});

test("the graph draws an estimate with a ~ on its label", () => {
	const estimated = SEGMENTS.context_graph.render(
		segmentCtx({ contextPercent: 9.2, contextTokens: 12_000, contextEstimated: true }),
	);
	assert.ok(estimated.visible);
	assert.equal(stripAnsi(estimated.content), `${"▋".repeat(2)}${"░".repeat(18)} ~9.2%/131K`);

	const measured = SEGMENTS.context_graph.render(segmentCtx({ contextPercent: 9.2, contextTokens: 12_000 }));
	assert.equal(stripAnsi(measured.content), `${"▋".repeat(2)}${"░".repeat(18)} 9.2%/131K`);

	const unknown = SEGMENTS.context_graph.render(segmentCtx({}));
	assert.equal(unknown.visible, false, "with nothing to size against, the graph still stays out");
});
