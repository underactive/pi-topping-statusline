/**
 * The bottom bar hosts the progress of every compaction that pi runs.
 * CompactionMonitor tracks progress from pi's session events.
 */
import { renderCompactionBar } from "./compaction-bar.js";
import { COMPACTION_STAND_INS } from "./settings.js";
import type { CompactionProgressView, EffectiveStatusLineSettings } from "./types.js";

/** Whether the bottom bar has somewhere to put the progress: the setting is on and a segment it stands in for is shown. */
export function hostsCompactionProgress(effective: EffectiveStatusLineSettings): boolean {
	return (
		effective.embedCompactionProgress &&
		effective.bottomRightSegments.some((id) => COMPACTION_STAND_INS[id] !== undefined)
	);
}

/**
 * A representative hosted compaction (66% usage, 35% still to go, so 47% summarized), shown in
 * the settings preview. Real figures vary in digit count, but this stands in for a typical session
 * without committing to a worst case that would starve the rest of the bar.
 * The bar renders when this function is called, so it uses pi's current color depth.
 * The settings preview is its only user.
 */
export function compactionPreviewView(): CompactionProgressView {
	return {
		bar: renderCompactionBar(35),
		percent: 47,
		tokensBefore: 86_000,
		contextWindow: 131_072,
		elapsedMs: 16_300,
	};
}
