import type { CustomEditor } from "@earendil-works/pi-coding-agent";
import { easeFade } from "./theme.js";

export type StatusIndicatorKind = NonNullable<Parameters<CustomEditor["setWorkingStatusIndicator"]>[0]>["kind"];

/** Briefly retain a cleared status so handoffs between host indicators do not flash. */
export const STATUS_HOLD_MS = 150;
/** Cross-fade budget when the embedded working status disappears: half out, half in. */
export const WORKING_FADE_MS = 750;

/** True when a status kind is a message-style indicator rather than the working spinner. */
export function isMessageKind(kind: StatusIndicatorKind | undefined): boolean {
	return kind !== undefined && kind !== "working";
}

/** Which status the top-left group shows this frame and how far it has faded. */
export interface StatusFrame {
	status: string | undefined;
	leftFade?: number;
	/** Kind of the status this frame shows, for truncation styling. */
	kind: StatusIndicatorKind | undefined;
	/** True while a hold or fade still needs repaints. */
	pending: boolean;
}

interface StatusExit {
	holdUntil: number;
	fadeMs: number;
}

/**
 * Resolve host status-indicator handoffs into stable top-bar frames.
 *
 * pi 0.86 routes working, retry, compaction, and branch-summary indicators
 * through the editor border and may clear the slot between them. A cleared
 * status is held briefly to bridge that gap. Only the working indicator — the
 * one that genuinely ends a stream — then cross-fades back to user segments.
 */
export class StatusTransition {
	#liveShown = false;
	#lastStatus: string | undefined;
	#lastKind: StatusIndicatorKind | undefined;
	#exit: StatusExit | undefined;

	resolve(live: string | undefined, kind: StatusIndicatorKind | undefined, now: number): StatusFrame {
		if (live !== undefined) {
			this.#liveShown = true;
			this.#lastStatus = live;
			this.#lastKind = kind;
			this.#exit = undefined;
			return { status: live, kind, pending: false };
		}

		if (this.#liveShown) {
			this.#liveShown = false;
			this.#exit = {
				holdUntil: now + STATUS_HOLD_MS,
				fadeMs: isMessageKind(this.#lastKind) ? 0 : WORKING_FADE_MS,
			};
		}

		const exit = this.#exit;
		if (!exit) return { status: undefined, kind: undefined, pending: false };
		if (now < exit.holdUntil) {
			return { status: this.#lastStatus, kind: this.#lastKind, pending: true };
		}
		const elapsed = now - exit.holdUntil;
		if (elapsed >= exit.fadeMs) {
			this.#clearExit();
			return { status: undefined, kind: undefined, pending: false };
		}
		const half = exit.fadeMs / 2;
		const outgoing = elapsed < half;
		const leftFade = easeFade(outgoing ? 1 - elapsed / half : (elapsed - half) / half);
		return {
			status: outgoing ? this.#lastStatus : undefined,
			kind: outgoing ? this.#lastKind : undefined,
			leftFade,
			pending: true,
		};
	}

	pending(now: number): boolean {
		const exit = this.#exit;
		return exit !== undefined && now < exit.holdUntil + exit.fadeMs;
	}

	reset(): void {
		this.#liveShown = false;
		this.#clearExit();
	}

	#clearExit(): void {
		this.#lastStatus = undefined;
		this.#lastKind = undefined;
		this.#exit = undefined;
	}
}
