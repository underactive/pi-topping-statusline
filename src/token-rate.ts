/**
 * Live tok/s monitor for the token_rate segment.
 *
 * Upstream oh-my-pi computes the badge from the last assistant message's
 * usage.output / duration, but pi only reports usage at message end, so a
 * live rate needs an estimator. The pipeline (word counter, EMA tracker and
 * hold/fade lifecycle) comes from @underactive/pi-topping-primitives/activity:
 *
 * - text/thinking deltas are counted as approximate tokens (word boundaries);
 * - an EMA (alpha 0.4) smooths 100ms samples into a rate;
 * - message_end reconciles the estimate against exact usage.output;
 * - the last rate holds for HOLD_MS, fades over FADE_MS, then goes idle.
 *
 * The segment itself never disappears: idle renders as `--- tok/s`.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { RateHoldFade, StreamingWordCounter } from "@underactive/pi-topping-primitives/activity";
import { FADE_SHADE_COUNT } from "./theme.js";
import type { TokenRateDisplay } from "./types.js";

const SAMPLE_INTERVAL_MS = 100;
/** pi-topping TOKEN_RATE_HOLD_MS — retained value stays at full color. */
const HOLD_MS = 1_500;
/** pi-topping fades in 250ms; here the fade is stretched to 0.5s. */
const FADE_MS = 500;

export class TokenRateMonitor {
	#requestRender: () => void;
	#enabled = false;
	#busy = false;
	#timer: ReturnType<typeof setInterval> | undefined;

	// Token accounting: exact usage from message_end + live estimate since.
	#confirmTokens = 0;
	#liveTokens = 0;
	#counter = new StreamingWordCounter();

	// EMA tracker plus hold/fade lifecycle.
	#rate = new RateHoldFade({
		holdMs: HOLD_MS,
		fadeMs: FADE_MS,
		shadeCount: FADE_SHADE_COUNT,
		sampleIntervalMs: SAMPLE_INTERVAL_MS,
	});
	#lastRendered: TokenRateDisplay | undefined;

	constructor(requestRender: () => void) {
		this.#requestRender = requestRender;
	}

	attach(pi: ExtensionAPI): void {
		pi.on("agent_start", () => {
			if (!this.#enabled) return;
			this.#busy = true;
			this.#resetTurn();
			this.#startTimer();
		});
		pi.on("agent_settled", () => {
			if (!this.#enabled) return;
			this.#busy = false;
		});
		pi.on("message_start", event => {
			if (!this.#enabled || event.message.role !== "assistant") return;
			this.#liveTokens = 0;
			this.#counter.reset();
		});
		pi.on("message_update", event => {
			if (!this.#enabled) return;
			const assistantEvent = event.assistantMessageEvent;
			if (assistantEvent.type === "text_delta" || assistantEvent.type === "thinking_delta") {
				this.#liveTokens += this.#counter.count(assistantEvent.delta, assistantEvent.type);
			}
		});
		pi.on("message_end", event => {
			if (!this.#enabled || event.message.role !== "assistant") return;
			const exact = event.message.usage?.output;
			this.#confirmTokens += exact ?? this.#liveTokens;
			if (exact !== undefined) {
				// Reconciliation resets the EMA at message boundaries; the held rate
				// bridges the gap until fresh samples rebuild it.
				this.#rate.resetSampling(this.#confirmTokens);
			}
			this.#liveTokens = 0;
			this.#counter.reset();
		});
	}

	/** Events are only processed in TUI sessions; index.ts gates on mode. */
	enable(): void {
		this.#enabled = true;
	}

	disable(): void {
		this.#enabled = false;
		this.#busy = false;
		this.#stopTimer();
		this.#resetTurn();
	}

	/** Pure snapshot for the segment render; safe to call on any frame. */
	getDisplay(now = Date.now()): TokenRateDisplay {
		return this.#rate.display(now);
	}

	#resetTurn(): void {
		this.#confirmTokens = 0;
		this.#liveTokens = 0;
		this.#counter.reset();
		this.#rate.reset();
	}

	#tick(): void {
		const now = Date.now();
		if (this.#busy) this.#rate.sample(this.#confirmTokens + this.#liveTokens, now);
		const display = this.getDisplay(now);
		if (!this.#busy && display.phase === "idle") {
			this.#stopTimer();
		}
		if (
			!this.#lastRendered ||
			display.rate !== this.#lastRendered.rate ||
			display.phase !== this.#lastRendered.phase ||
			display.fadeShade !== this.#lastRendered.fadeShade
		) {
			this.#lastRendered = display;
			this.#requestRender();
		}
	}

	#startTimer(): void {
		this.#timer ??= setInterval(() => this.#tick(), SAMPLE_INTERVAL_MS);
		this.#timer.unref?.();
	}

	#stopTimer(): void {
		if (this.#timer) {
			clearInterval(this.#timer);
			this.#timer = undefined;
		}
	}
}
