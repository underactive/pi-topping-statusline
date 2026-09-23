import type { CustomEditor } from "@earendil-works/pi-coding-agent";
import { easeFade } from "./theme.js";

export type StatusIndicatorKind = NonNullable<Parameters<CustomEditor["setWorkingStatusIndicator"]>[0]>["kind"];

/** Slide-out time for a status that appears while the top-left group shows none. */
export const STATUS_SLIDE_MS = 300;
/** Briefly retain a cleared status so handoffs between host indicators do not flash. */
export const STATUS_HOLD_MS = 150;
/** Cross-fade budget when the embedded working status disappears: half out, half in. */
export const WORKING_FADE_MS = 750;

/** True when a status kind is a message-style indicator rather than the working spinner. */
export function isMessageKind(kind: StatusIndicatorKind | undefined): boolean {
	return kind !== undefined && kind !== "working";
}

/** Which status the top-left group shows this frame and how far it has slid out or faded. */
export interface StatusFrame {
	status: string | undefined;
	leftFade?: number;
	/** How far the status has slid out (0..1); absent once it is fully out. */
	reveal?: number;
	/** Kind of the status this frame shows, for truncation styling. */
	kind: StatusIndicatorKind | undefined;
	/** True while a slide, hold, or fade still needs repaints. */
	pending: boolean;
}

interface StatusExit {
	holdUntil: number;
	fadeMs: number;
}

/**
 * Resolve host status-indicator handoffs into stable top-bar frames.
 *
 * A status that appears while the top-left group shows none slides out over
 * STATUS_SLIDE_MS. pi 0.86 routes working, retry, compaction, and
 * branch-summary indicators through the editor border and may clear the slot
 * between them. A cleared status is held briefly to bridge that gap, and a
 * status arriving while the previous one is still drawn takes its place
 * without sliding again. Only the working indicator — the one that genuinely
 * ends a stream — then cross-fades back to user segments.
 */
export class StatusTransition {
	#liveShown = false;
	#lastStatus: string | undefined;
	#lastKind: StatusIndicatorKind | undefined;
	#exit: StatusExit | undefined;
	#slideFrom: number | undefined;

	resolve(live: string | undefined, kind: StatusIndicatorKind | undefined, now: number): StatusFrame {
		if (live !== undefined) {
			if (!this.#liveShown && !this.#exitDrawsStatus(now)) this.#slideFrom = now;
			this.#liveShown = true;
			this.#lastStatus = live;
			this.#lastKind = kind;
			this.#exit = undefined;
			return this.#withSlide({ status: live, kind, pending: false }, now);
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
			return this.#withSlide({ status: this.#lastStatus, kind: this.#lastKind, pending: true }, now);
		}
		const elapsed = now - exit.holdUntil;
		if (elapsed >= exit.fadeMs) {
			this.#clearExit();
			return { status: undefined, kind: undefined, pending: false };
		}
		const half = exit.fadeMs / 2;
		const outgoing = elapsed < half;
		const leftFade = easeFade(outgoing ? 1 - elapsed / half : (elapsed - half) / half);
		if (!outgoing) return { status: undefined, kind: undefined, leftFade, pending: true };
		return this.#withSlide({ status: this.#lastStatus, kind: this.#lastKind, leftFade, pending: true }, now);
	}

	pending(now: number): boolean {
		const exit = this.#exit;
		if (exit) return now < exit.holdUntil + exit.fadeMs;
		return this.#slideFrom !== undefined && now < this.#slideFrom + STATUS_SLIDE_MS;
	}

	reset(): void {
		this.#liveShown = false;
		this.#clearExit();
	}

	/** A cleared status is still drawn through its hold and the fade's outgoing half. */
	#exitDrawsStatus(now: number): boolean {
		const exit = this.#exit;
		return exit !== undefined && now < exit.holdUntil + exit.fadeMs / 2;
	}

	/**
	 * Add slide-out progress to a frame that draws a status. A status cleared
	 * mid-slide keeps sliding through its exit rather than snapping to full width.
	 */
	#withSlide(frame: StatusFrame, now: number): StatusFrame {
		if (this.#slideFrom === undefined) return frame;
		const progress = (now - this.#slideFrom) / STATUS_SLIDE_MS;
		if (progress >= 1) {
			this.#slideFrom = undefined;
			return frame;
		}
		return { ...frame, reveal: easeFade(progress), pending: true };
	}

	#clearExit(): void {
		this.#lastStatus = undefined;
		this.#lastKind = undefined;
		this.#exit = undefined;
		this.#slideFrom = undefined;
	}
}

/** How far content has slid out this frame. */
export interface RevealFrame {
	/** Slide-out progress (0..1); absent once the content is fully out. */
	reveal?: number;
	/** True while the slide still needs repaints. */
	pending: boolean;
}

/**
 * Slide content out over STATUS_SLIDE_MS each time it goes from absent to
 * present, as a status does. Content that changes while shown stays put.
 */
export class AppearanceTransition {
	#shown = false;
	#slideFrom: number | undefined;

	resolve(visible: boolean, now: number): RevealFrame {
		if (!visible) {
			this.reset();
			return { pending: false };
		}
		if (!this.#shown) {
			this.#shown = true;
			this.#slideFrom = now;
		}
		if (this.#slideFrom === undefined) return { pending: false };
		const progress = (now - this.#slideFrom) / STATUS_SLIDE_MS;
		if (progress >= 1) {
			this.#slideFrom = undefined;
			return { pending: false };
		}
		return { reveal: easeFade(progress), pending: true };
	}

	pending(now: number): boolean {
		return this.#slideFrom !== undefined && now < this.#slideFrom + STATUS_SLIDE_MS;
	}

	/** Forget the shown content so its next appearance slides out again. */
	reset(): void {
		this.#shown = false;
		this.#slideFrom = undefined;
	}
}
