/**
 * Tracks pi's built-in summarizer from pi's session events. The percent is a time-based estimate,
 * because pi does not expose the summarizer's stream.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderCompactionBar } from "./compaction-bar.js";
import type { CompactionProgressView } from "./types.js";

const COMPACTION_TICK_MS = 100;
const COMPACTION_COMPLETE_HOLD_MS = 900;
const SUMMARIZING_START_PERCENT = 10;
const SUMMARIZING_SPAN_PERCENT = 80;
const SUMMARIZING_TAU_MS = 25_000;
const SUMMARIZING_RATIO_CAP = 0.95;

/**
 * Starts at 10% and eases toward 90%, capped at 86% (START + SPAN × RATIO_CAP)
 * after about 75s; README.md and CHANGELOG.md quote the 10% and 86% figures.
 */
export function estimateCompactionPercent(elapsedMs: number): number {
	const elapsed = Number.isFinite(elapsedMs) && elapsedMs >= 0 ? elapsedMs : 0;
	const ratio = Math.min(SUMMARIZING_RATIO_CAP, 1 - Math.exp(-elapsed / SUMMARIZING_TAU_MS));
	return SUMMARIZING_START_PERCENT + SUMMARIZING_SPAN_PERCENT * ratio;
}

type CompactionRun = {
	startedAt: number;
	tokensBefore: number;
	contextWindow: number;
	completedAt: number | undefined;
};

export class CompactionMonitor {
	#requestRender: () => void;
	#now: () => number;
	#holdMs: number;
	#enabled = false;
	#run: CompactionRun | undefined;
	#tickTimer: ReturnType<typeof setInterval> | undefined;
	#holdTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(requestRender: () => void, options: { now?: () => number; holdMs?: number } = {}) {
		this.#requestRender = requestRender;
		this.#now = options.now ?? (() => performance.now());
		this.#holdMs = options.holdMs ?? COMPACTION_COMPLETE_HOLD_MS;
	}

	attach(pi: ExtensionAPI): void {
		pi.on("session_before_compact", (event, ctx) => {
			if (!this.#enabled) return;
			this.#clearTimers();
			this.#run = {
				startedAt: this.#now(),
				tokensBefore: event.preparation.tokensBefore,
				contextWindow: ctx.getContextUsage()?.contextWindow ?? ctx.model?.contextWindow ?? 0,
				completedAt: undefined,
			};
			this.#tickTimer = setInterval(this.#requestRender, COMPACTION_TICK_MS);
			this.#tickTimer.unref?.();
			this.#requestRender();
		});
		pi.on("session_compact", () => {
			if (!this.#run || this.#run.completedAt !== undefined) return;
			this.#run.completedAt = this.#now();
			this.#stopTickTimer();
			this.#holdTimer = setTimeout(() => this.#endRun(), this.#holdMs);
			this.#holdTimer.unref?.();
			this.#requestRender();
		});
		pi.on("session_compact_failed", () => this.#endRun());
		// pi < 0.84.3 has no session_compact_failed; the next agent run is the only sign a run died.
		pi.on("agent_start", () => {
			if (this.#run && this.#run.completedAt === undefined) this.#endRun();
		});
	}

	enable(): void {
		this.#enabled = true;
	}

	disable(): void {
		this.#enabled = false;
		this.#endRun();
	}

	view(): CompactionProgressView | undefined {
		const run = this.#run;
		if (!run) return undefined;
		const elapsed = (run.completedAt ?? this.#now()) - run.startedAt;
		const percent = run.completedAt !== undefined ? 100 : estimateCompactionPercent(elapsed);
		const usage =
			Number.isFinite(run.tokensBefore) && run.tokensBefore > 0 &&
			Number.isFinite(run.contextWindow) && run.contextWindow > 0
				? Math.min(100, Math.max(0, (run.tokensBefore / run.contextWindow) * 100))
				: 0;
		const remaining = usage * (1 - percent / 100);
		return {
			bar: renderCompactionBar(remaining, {
				shimmerElapsedMs: run.completedAt === undefined ? elapsed : undefined,
			}),
			percent,
			tokensBefore: run.tokensBefore,
			contextWindow: run.contextWindow,
			elapsedMs: elapsed,
		};
	}

	#endRun(): void {
		this.#clearTimers();
		if (!this.#run) return;
		this.#run = undefined;
		this.#requestRender();
	}

	#clearTimers(): void {
		this.#stopTickTimer();
		if (this.#holdTimer) {
			clearTimeout(this.#holdTimer);
			this.#holdTimer = undefined;
		}
	}

	#stopTickTimer(): void {
		if (this.#tickTimer) {
			clearInterval(this.#tickTimer);
			this.#tickTimer = undefined;
		}
	}
}
