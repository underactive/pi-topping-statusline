/**
 * Live tok/s monitor for the token_rate segment.
 *
 * Upstream oh-my-pi computes the badge from the last assistant message's
 * usage.output / duration, but pi only reports usage at message end, so a
 * live rate needs an estimator. The pipeline (StreamingWordCounter + EMA
 * tracker + hold/fade lifecycle) is copied from pi-topping (same author,
 * ../pi-topping/src/{format,activity-meter,session}.ts):
 *
 * - text/thinking deltas are counted as approximate tokens (word boundaries);
 * - an EMA (alpha 0.4) smooths 100ms samples into a rate;
 * - message_end reconciles the estimate against exact usage.output;
 * - the last rate holds for HOLD_MS, fades over FADE_MS, then goes idle.
 *
 * The segment itself never disappears: idle renders as `--- tok/s`.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FADE_SHADE_COUNT } from "./theme.js";
import type { TokenRateDisplay } from "./types.js";

const SAMPLE_INTERVAL_MS = 100;
/** pi-topping TOKEN_RATE_HOLD_MS — retained value stays at full color. */
const HOLD_MS = 1_500;
/** pi-topping fades in 250ms; here the fade is stretched to 0.5s. */
const FADE_MS = 500;
const EMA_ALPHA = 0.4;

/** Incremental whitespace-boundary word counter (pi-topping StreamingWordCounter). */
class StreamingWordCounter {
	#inWordByStream = new Map<string, boolean>();

	count(text: string, stream = "default"): number {
		let inWord = this.#inWordByStream.get(stream) ?? false;
		let count = 0;
		for (let i = 0; i < text.length; i++) {
			const code = text.charCodeAt(i);
			if (isWhitespace(code)) {
				inWord = false;
			} else if (!inWord) {
				count++;
				inWord = true;
			}
		}
		this.#inWordByStream.set(stream, inWord);
		return count;
	}

	reset(): void {
		this.#inWordByStream.clear();
	}
}

function isWhitespace(code: number): boolean {
	return (
		code === 32 ||
		(code >= 9 && code <= 13) ||
		code === 160 ||
		code === 0x1680 ||
		(code >= 0x2000 && code <= 0x200a) ||
		code === 0x2028 ||
		code === 0x2029 ||
		code === 0x202f ||
		code === 0x205f ||
		code === 0x3000 ||
		code === 0xfeff
	);
}

export class TokenRateMonitor {
	#requestRender: () => void;
	#enabled = false;
	#busy = false;
	#timer: ReturnType<typeof setInterval> | undefined;

	// Token accounting: exact usage from message_end + live estimate since.
	#confirmTokens = 0;
	#liveTokens = 0;
	#counter = new StreamingWordCounter();

	// EMA tracker state (pi-topping TokRateTracker).
	#emaRate = 0;
	#emaLastTotal = 0;
	#emaLastTime = 0;
	#emaHasSample = false;
	#emaPendingTokens = 0;

	// Hold/fade lifecycle (pi-topping session.ts tick).
	#lastSampledAt = 0;
	#lastSampleTotal = 0;
	#heldRate: number | null = null;
	#fadeStartsAt = 0;
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
				this.#resetEma();
				this.#lastSampledAt = 0;
				this.#lastSampleTotal = this.#confirmTokens;
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
		if (this.#heldRate !== null && now < this.#fadeStartsAt) {
			return { rate: this.#heldRate, phase: "active", fadeShade: 0 };
		}
		if (this.#heldRate !== null && now < this.#fadeStartsAt + FADE_MS) {
			const shade = Math.floor((now - this.#fadeStartsAt) / (FADE_MS / FADE_SHADE_COUNT));
			return { rate: this.#heldRate, phase: "fading", fadeShade: shade };
		}
		return { rate: null, phase: "idle", fadeShade: 0 };
	}

	#resetTurn(): void {
		this.#confirmTokens = 0;
		this.#liveTokens = 0;
		this.#counter.reset();
		this.#resetEma();
		this.#lastSampledAt = 0;
		this.#lastSampleTotal = 0;
		this.#heldRate = null;
		this.#fadeStartsAt = 0;
	}

	#resetEma(): void {
		this.#emaRate = 0;
		this.#emaLastTotal = 0;
		this.#emaLastTime = 0;
		this.#emaHasSample = false;
		this.#emaPendingTokens = 0;
	}

	#sampleEma(total: number, now: number): void {
		if (!this.#emaHasSample) {
			this.#emaLastTotal = total;
			this.#emaHasSample = true;
			this.#emaLastTime = now;
			return;
		}
		const elapsedSeconds = (now - this.#emaLastTime) / 1_000;
		if (elapsedSeconds <= 0) {
			this.#emaPendingTokens += Math.max(0, total - this.#emaLastTotal);
			this.#emaLastTotal = total;
			return;
		}
		const totalDelta = this.#emaPendingTokens + Math.max(0, total - this.#emaLastTotal);
		const instantRate = totalDelta / elapsedSeconds;
		this.#emaRate = EMA_ALPHA * instantRate + (1 - EMA_ALPHA) * this.#emaRate;
		this.#emaLastTotal = total;
		this.#emaLastTime = now;
		this.#emaPendingTokens = 0;
	}

	#tick(): void {
		const now = Date.now();
		if (this.#busy && now - this.#lastSampledAt >= SAMPLE_INTERVAL_MS) {
			const total = this.#confirmTokens + this.#liveTokens;
			// Do not reset the fade for an EMA-only decay while output is quiet.
			const hasNewTokens = total > this.#lastSampleTotal;
			this.#lastSampleTotal = total;
			this.#sampleEma(total, now);
			this.#lastSampledAt = now;
			const rounded = Math.round(this.#emaRate);
			if (rounded > 0 && hasNewTokens) {
				this.#heldRate = rounded;
				this.#fadeStartsAt = now + HOLD_MS;
			}
		}
		if (!this.#busy && now >= this.#fadeStartsAt + FADE_MS) {
			this.#stopTimer();
		}
		const display = this.getDisplay(now);
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
