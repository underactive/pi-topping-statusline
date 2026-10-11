import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CompactionMonitor, estimateCompactionPercent } from "../compaction-progress.ts";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type Handler = (payload?: unknown, ctx?: unknown) => void;

function fakePi(): { pi: ExtensionAPI; emit: (event: string, payload?: unknown, ctx?: unknown) => void } {
	const handlers = new Map<string, Handler>();
	const pi = { on: (event: string, handler: Handler) => handlers.set(event, handler) } as unknown as ExtensionAPI;
	return { pi, emit: (event, payload, ctx) => handlers.get(event)?.(payload, ctx) };
}

const ctx = {
	getContextUsage: () => ({ contextWindow: 131_072, tokens: null, percent: null }),
	model: { contextWindow: 200_000 },
};
const beforeCompact = (tokensBefore = 86_000) => ({ preparation: { tokensBefore } });
const filledCells = (bar: string) => (bar.match(/▋/g) ?? []).length;
const stripAnsi = (bar: string) => bar.replace(/\x1b\[[0-9;]*m/g, "");

test("estimateCompactionPercent follows the bounded time curve", () => {
	assert.equal(estimateCompactionPercent(0), 10);
	const one = estimateCompactionPercent(1_000);
	const ten = estimateCompactionPercent(10_000);
	const sixty = estimateCompactionPercent(60_000);
	assert.ok(one > 10 && ten > one && sixty > ten);
	assert.ok(sixty <= 86);
	assert.equal(estimateCompactionPercent(Number.NaN), 10);
	assert.equal(estimateCompactionPercent(-5), 10);
	assert.equal(estimateCompactionPercent(1_000_000), 86);
});

test("monitor tracks starts, elapsed time and context usage", () => {
	const { pi, emit } = fakePi();
	let now = 1_000;
	const monitor = new CompactionMonitor(() => {}, { now: () => now });
	monitor.attach(pi);
	assert.equal(monitor.view(), undefined);
	emit("session_before_compact", beforeCompact(), ctx);
	assert.equal(monitor.view(), undefined, "disabled monitor ignores events");
	monitor.enable();
	emit("session_before_compact", beforeCompact(), ctx);
	now += 1_000;
	const view = monitor.view();
	assert.ok(view);
	assert.equal(view.tokensBefore, 86_000);
	assert.equal(view.contextWindow, 131_072);
	assert.equal(view.elapsedMs, 1_000);
	monitor.disable();
});

test("context window falls back to the model and progress advances with elapsed time", () => {
	const { pi, emit } = fakePi();
	let now = 10_000;
	const monitor = new CompactionMonitor(() => {}, { now: () => now });
	monitor.attach(pi);
	monitor.enable();
	emit("session_before_compact", beforeCompact(), { getContextUsage: () => undefined, model: { contextWindow: 200_000 } });
	const first = monitor.view();
	assert.ok(first);
	assert.equal(first.contextWindow, 200_000);
	now += 15_000;
	const later = monitor.view();
	assert.ok(later);
	assert.ok(later.percent > first.percent);
	monitor.disable();
});

test("remaining filled cells decrease with time and unknown usage is trough only", () => {
	const { pi, emit } = fakePi();
	let now = 0;
	const monitor = new CompactionMonitor(() => {}, { now: () => now });
	monitor.attach(pi);
	monitor.enable();
	emit("session_before_compact", beforeCompact(), ctx);
	const first = monitor.view();
	assert.ok(first);
	now = 60_000;
	const later = monitor.view();
	assert.ok(later);
	assert.ok(filledCells(later.bar) < filledCells(first.bar));
	monitor.disable();

	const unknown = fakePi();
	const emptyMonitor = new CompactionMonitor(() => {}, { now: () => 0 });
	emptyMonitor.attach(unknown.pi);
	emptyMonitor.enable();
	unknown.emit("session_before_compact", beforeCompact(), { getContextUsage: () => ({ contextWindow: 0 }), model: { contextWindow: 0 } });
	assert.equal(stripAnsi(emptyMonitor.view()!.bar), "░".repeat(20));
	emptyMonitor.disable();
});

test("completion freezes a drained bar during the hold and then releases the run", async () => {
	const { pi, emit } = fakePi();
	let now = 100;
	let renders = 0;
	const monitor = new CompactionMonitor(() => renders++, { now: () => now, holdMs: 20 });
	monitor.attach(pi);
	monitor.enable();
	emit("session_before_compact", beforeCompact(), ctx);
	now = 500;
	emit("session_compact");
	const completed = monitor.view();
	assert.ok(completed);
	assert.equal(completed.percent, 100);
	assert.equal(stripAnsi(completed.bar), "░".repeat(20));
	now = 5_000;
	assert.equal(monitor.view()?.elapsedMs, completed.elapsedMs);
	await sleep(40);
	assert.equal(monitor.view(), undefined);
	assert.ok(renders >= 3, "completion and hold end both request renders");
	monitor.disable();
});

test("failure ends at once, including a pending hold, and is a no-op without a run", () => {
	const { pi, emit } = fakePi();
	let renders = 0;
	const monitor = new CompactionMonitor(() => renders++, { now: () => 0, holdMs: 10_000 });
	monitor.attach(pi);
	monitor.enable();
	emit("session_compact_failed");
	assert.equal(renders, 0);
	emit("session_before_compact", beforeCompact(), ctx);
	emit("session_compact");
	emit("session_compact_failed");
	assert.equal(monitor.view(), undefined);
	const afterFailure = renders;
	emit("session_compact_failed");
	assert.equal(renders, afterFailure);
	monitor.disable();
});

test("agent_start guards an active run but leaves a completion hold intact", () => {
	const { pi, emit } = fakePi();
	const monitor = new CompactionMonitor(() => {}, { now: () => 0, holdMs: 10_000 });
	monitor.attach(pi);
	monitor.enable();
	emit("session_before_compact", beforeCompact(), ctx);
	emit("agent_start");
	assert.equal(monitor.view(), undefined);
	emit("session_before_compact", beforeCompact(), ctx);
	emit("session_compact");
	emit("agent_start");
	assert.equal(monitor.view()?.percent, 100);
	monitor.disable();
});

test("a new compaction replaces the previous run", () => {
	const { pi, emit } = fakePi();
	let now = 1_000;
	const monitor = new CompactionMonitor(() => {}, { now: () => now });
	monitor.attach(pi);
	monitor.enable();
	emit("session_before_compact", beforeCompact(), ctx);
	now += 1_000;
	emit("session_before_compact", beforeCompact(70_000), ctx);
	assert.equal(monitor.view()?.elapsedMs, 0);
	assert.equal(monitor.view()?.tokensBefore, 70_000);
	monitor.disable();
});

test("disable ends the run and stops repeated ticks", async () => {
	const { pi, emit } = fakePi();
	let renders = 0;
	const monitor = new CompactionMonitor(() => renders++);
	monitor.attach(pi);
	monitor.enable();
	emit("session_before_compact", beforeCompact(), ctx);
	await sleep(250);
	assert.ok(renders >= 3);
	emit("session_compact_failed");
	const endedRenders = renders;
	await sleep(150);
	assert.equal(renders, endedRenders);
	emit("session_before_compact", beforeCompact(), ctx);
	monitor.disable();
	const disabledRenders = renders;
	await sleep(150);
	assert.equal(renders, disabledRenders);
	assert.equal(monitor.view(), undefined);
});
