/**
 * Whether the bottom bar can host compaction progress, and the sample view the settings preview shows.
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
 * A representative hosted compaction (86K of a 131K window is 66% usage; at 47% summarized the
 * bar still holds 35% of the window), shown in the settings preview. Real figures vary in digit
 * count, but this stands in for a typical session without committing to a worst case that would
 * starve the rest of the bar.
 * The bar renders when this function is called, so it uses pi's current color depth.
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
