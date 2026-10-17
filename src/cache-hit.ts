import type { Usage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { stripAnsi } from "./footer.js";
import { theme, type StatusColor } from "./theme.js";

export const CACHE_HIT_MIN_CELLS = 3;
export const CACHE_HIT_MAX_CELLS = 10;
export const CACHE_HIT_DEFAULT_CELLS = 4;

/** A bar of any size starts its log scale here: the second cell fills at 50% (a 50% miss rate)... */
const SECOND_CELL_MISS_PERCENT = 50;
/** ...and the last cell fills at 99.21875% (a 0.78125% miss rate, 64x below the second cell's). */
const LAST_CELL_MISS_PERCENT = 0.78125;

/**
 * Hit-rate bands for the bar's single color, independent of the bar's size so a
 * given hit rate reads the same at every length: red below 50%, orange below
 * 87.5%, yellow below 96.875%, then a subdued green so high hit rates read as good.
 */
const CACHE_HIT_COLOR_BANDS: readonly { below: number; color: StatusColor }[] = [
	{ below: 50, color: "error" },
	{ below: 87.5, color: "statusLineContextElevated" },
	{ below: 96.875, color: "warning" },
];
const CACHE_HIT_TOP_COLOR: StatusColor = "statusLineCacheHit";

const FILLED = "\u258b";
const TROUGH = "\u2591";

const tokens = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);

/**
 * Pi's footer `CH` figure: cache reads over all prompt tokens (cache writes
 * included) for the latest assistant response, not the session total. Null
 * when no assistant response has reported prompt tokens.
 */
export function getCacheHitPercent(entries: readonly SessionEntry[]): number | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type !== "message" || entry.message.role !== "assistant") continue;
		const usage: Usage | undefined = entry.message.usage;
		if (!usage) return null;
		const read = tokens(usage.cacheRead);
		const promptTokens = tokens(usage.input) + read + tokens(usage.cacheWrite);
		return promptTokens > 0 ? Math.min(100, (read / promptTokens) * 100) : null;
	}
	return null;
}

/** The `CH<pct>%` figure in pi's footer stats line, when pi shows one. */
export function parseCacheHitStat(stats: string | undefined): number | null {
	if (!stats) return null;
	const match = /(?:^|\s)CH(\d+(?:\.\d+)?)%/.exec(stripAnsi(stats));
	if (!match) return null;
	const percent = Number(match[1]);
	return Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : null;
}

/** Remove Pi's CH figure after it has been moved beside the cache-hit graph. */
export function stripCacheHitStat(stats: string | undefined): string | undefined {
	if (!stats) return undefined;
	const stripped = stats.replace(/(?:^|\s)CH\d+(?:\.\d+)?%/, "").replace(/\s+/g, " ").trim();
	return stripped || undefined;
}

/** A bar size from settings, snapped to a whole number in range; anything unusable becomes the default. */
export function clampCacheHitCells(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return CACHE_HIT_DEFAULT_CELLS;
	return Math.min(CACHE_HIT_MAX_CELLS, Math.max(CACHE_HIT_MIN_CELLS, Math.round(value)));
}

/**
 * Hit rates at which cells 2..`cells` fill. The first cell is not listed: any hit
 * above 0% fills it. The rest fill logarithmically, so the miss rate shrinks by
 * the same factor from one cell to the next, from 50% at the second cell to
 * 99.21875% at the last. That keeps the resolution near 100% at any size: five
 * cells quarter the miss rate per cell (50, 87.5, 96.875, 99.21875), four cells
 * cut it to an eighth, ten to roughly 0.59x.
 */
export function getCacheHitThresholds(cells: number): number[] {
	const size = clampCacheHitCells(cells);
	const steps = size - 2;
	const thresholds: number[] = [];
	for (let k = 0; k <= steps; k++) {
		const miss = SECOND_CELL_MISS_PERCENT * (LAST_CELL_MISS_PERCENT / SECOND_CELL_MISS_PERCENT) ** (k / steps);
		// Rounded so float noise cannot nudge an exact figure like 87.5 just past its own threshold.
		thresholds.push(Math.round((100 - miss) * 1e6) / 1e6);
	}
	return thresholds;
}

/** Filled cells on a logarithmic scale: only 0% is empty, and any hit at all fills the first cell. */
export function getCacheHitGraphCells(percent: number, cells = CACHE_HIT_DEFAULT_CELLS): number {
	if (!Number.isFinite(percent) || percent <= 0) return 0;
	const clamped = Math.min(100, percent);
	return 1 + getCacheHitThresholds(cells).filter(threshold => clamped >= threshold).length;
}

/** The bar's single color for a hit rate; the same bands at every bar size. */
export function getCacheHitColor(percent: number): StatusColor {
	return CACHE_HIT_COLOR_BANDS.find(band => percent < band.below)?.color ?? CACHE_HIT_TOP_COLOR;
}

/**
 * Cache-hit graph of `cells` segments (3–10, default 4). The whole filled bar
 * takes one color from the hit rate: red, orange, yellow, then a subdued green
 * from 96.875% through a perfect hit.
 */
export function renderCacheHitGraph(percent: number, cells = CACHE_HIT_DEFAULT_CELLS): string {
	const size = clampCacheHitCells(cells);
	const filled = getCacheHitGraphCells(percent, size);
	const filledPart = filled > 0 ? `${theme.getFgAnsi(getCacheHitColor(percent))}${FILLED.repeat(filled)}` : "";
	const troughPart = filled < size ? `\x1b[39m\x1b[2m${TROUGH.repeat(size - filled)}\x1b[22m` : "";
	return `${filledPart}${troughPart}\x1b[39m`;
}
