/**
 * pi-topping-compact's compaction progress, hosted in the bottom bar.
 *
 * The two extensions talk over pi's extension event bus. This extension
 * announces on COMPACTION_EMBED_CHANNEL whether its bottom bar has room for the
 * progress; pi-topping-compact broadcasts snapshots on COMPACTION_PROGRESS_CHANNEL
 * only while it does, and ends with `{ active: false }` so pi's stats and the
 * context graph return the moment the compaction finishes. Its completion
 * result still appears above the editor, in pi-topping-compact's own widget.
 */
import { COMPACTION_STAND_INS } from "./settings.js";
import { hexToFgAnsi } from "./theme.js";
import type { CompactionProgressView, EffectiveStatusLineSettings } from "./types.js";

/** Announced as `{ embedded: boolean }`. Shared with pi-topping-compact. */
export const COMPACTION_EMBED_CHANNEL = "pi-topping-statusline:compaction-progress-embedded";

/** Carries a CompactionProgressView plus `active: true`, or `{ active: false }`. Shared with pi-topping-compact. */
export const COMPACTION_PROGRESS_CHANNEL = "pi-topping-compact:compaction-progress";

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** The view in a broadcast, or undefined when it reports no active compaction or is malformed. */
export function parseCompactionProgress(data: unknown): CompactionProgressView | undefined {
	if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
	const { active, bar, percent, tokensBefore, contextWindow, elapsedMs } = data as Record<string, unknown>;
	if (active !== true || typeof bar !== "string") return undefined;
	if (
		!isFiniteNumber(percent) ||
		!isFiniteNumber(tokensBefore) ||
		!isFiniteNumber(contextWindow) ||
		!isFiniteNumber(elapsedMs)
	) {
		return undefined;
	}
	return { bar, percent, tokensBefore, contextWindow, elapsedMs };
}

/** Whether the bottom bar has somewhere to put the progress: the setting is on and a segment it stands in for is shown. */
export function hostsCompactionProgress(effective: EffectiveStatusLineSettings): boolean {
	return (
		effective.embedCompactionProgress &&
		effective.bottomRightSegments.some((id) => COMPACTION_STAND_INS[id] !== undefined)
	);
}

/** pi-topping-compact's phosphor bar as it looks with a third of the context left to compact. */
const FIT_PROBE_BAR = `${hexToFgAnsi("#72f1b8")}${"\u258b".repeat(7)}\x1b[39m\x1b[2m${hexToFgAnsi("#266446")}${"\u2591".repeat(13)}\x1b[22m\x1b[39m`;

/**
 * A representative hosted compaction (66% usage, 35% still to go, so 47% summarized), used to
 * measure whether the stand-in segments have room before any real progress has broadcast, and
 * shown in the settings preview. Real figures vary in digit count, but this stands in for a
 * typical session without committing to a worst case that would starve the rest of the bar.
 */
export const COMPACTION_FIT_PROBE: CompactionProgressView = {
	bar: FIT_PROBE_BAR,
	percent: 47,
	tokensBefore: 86_000,
	contextWindow: 131_072,
	elapsedMs: 16_300,
};
