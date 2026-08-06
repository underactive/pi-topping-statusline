/**
 * TokenRateMonitor's event pipeline: message_update/message_end driving the
 * live EMA sampler, independent of the segment's display formatting (see
 * token-rate.test.ts).
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TokenRateMonitor } from "../token-rate.ts";

function createFakePi(): { pi: ExtensionAPI; emit: (event: string, payload?: unknown) => void } {
	const handlers = new Map<string, (payload: unknown) => void>();
	const pi = {
		on: (event: string, handler: (payload: unknown) => void) => {
			handlers.set(event, handler);
		},
	} as unknown as ExtensionAPI;
	return { pi, emit: (event, payload) => handlers.get(event)?.(payload) };
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const textDelta = (delta: string) => ({ assistantMessageEvent: { type: "text_delta", delta } });

test("idle before any turn starts", () => {
	const monitor = new TokenRateMonitor(() => {});
	monitor.enable();
	assert.equal(monitor.getDisplay().phase, "idle");
	assert.equal(monitor.getDisplay().rate, null);
});

test("streamed text deltas build a live rate once the sampler ticks", async () => {
	const { pi, emit } = createFakePi();
	const monitor = new TokenRateMonitor(() => {});
	monitor.attach(pi);
	monitor.enable();
	emit("agent_start");
	emit("message_start", { message: { role: "assistant" } });
	for (let i = 0; i < 3; i++) {
		emit("message_update", textDelta("one two three four five"));
		await sleep(120);
	}
	const display = monitor.getDisplay();
	assert.equal(display.phase, "active");
	assert.ok(typeof display.rate === "number" && display.rate > 0);
	monitor.disable();
});

test("message_end reconciles against the exact usage.output, then the held rate fades to idle", async () => {
	const { pi, emit } = createFakePi();
	const monitor = new TokenRateMonitor(() => {});
	monitor.attach(pi);
	monitor.enable();
	emit("agent_start");
	emit("message_start", { message: { role: "assistant" } });
	for (let i = 0; i < 3; i++) {
		emit("message_update", textDelta("one two three four five"));
		await sleep(120);
	}
	emit("message_end", { message: { role: "assistant", usage: { output: 42 } } });
	emit("agent_settled");
	assert.equal(monitor.getDisplay().phase, "active");
	await sleep(2200);
	assert.equal(monitor.getDisplay().phase, "idle");
	assert.equal(monitor.getDisplay().rate, null);
	monitor.disable();
});

test("disable stops the sampler and returns to idle immediately", () => {
	const { pi, emit } = createFakePi();
	const monitor = new TokenRateMonitor(() => {});
	monitor.attach(pi);
	monitor.enable();
	emit("agent_start");
	monitor.disable();
	assert.equal(monitor.getDisplay().phase, "idle");
});

test("events are ignored while the monitor is disabled", async () => {
	const { pi, emit } = createFakePi();
	const monitor = new TokenRateMonitor(() => {});
	monitor.attach(pi);
	emit("agent_start");
	emit("message_start", { message: { role: "assistant" } });
	emit("message_update", textDelta("one two three four five"));
	await sleep(150);
	assert.equal(monitor.getDisplay().phase, "idle");
});
