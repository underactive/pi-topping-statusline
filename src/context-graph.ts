/**
 * Context usage bar graph, ported from pi-synthwave-statusline's generateDots
 * with OMP's palette substituted: each filled cell is colored by the threshold
 * band its own position falls into, so the graph's gradient matches the bar's
 * context percentage color at every fill level.
 */
import { formatContextUsage, getContextUsageLevel, getContextUsageThemeColor } from "./context-thresholds.js";
import { theme } from "./theme.js";

const CELLS = 20;
const FILLED = "\u258b";
const TROUGH = "\u2591";

const cellColor = (percent: number, contextWindow: number): string =>
	theme.getFgAnsi(getContextUsageThemeColor(getContextUsageLevel(percent, contextWindow)));

export function renderContextGraph(
	percent: number,
	contextWindow: number,
	opts: { usedTokens?: number; labelColor?: string; showBar?: boolean; showStats?: boolean } = {},
): string {
	const parts: string[] = [];
	if (opts.showBar !== false) {
		const filled = Math.min(CELLS, Math.max(0, Math.round((percent * CELLS) / 100)));
		let bar = "";
		let prevColor = "";
		for (let i = 0; i < filled; i++) {
			const c = cellColor(((i + 1) / CELLS) * 100, contextWindow);
			if (c !== prevColor) {
				bar += c;
				prevColor = c;
			}
			bar += FILLED;
		}
		// Resets stay fg/attribute-only (39/22, never 0) so a caller's background
		// fill survives the whole run.
		if (filled < CELLS) bar += `\x1b[39m\x1b[2m${TROUGH.repeat(CELLS - filled)}\x1b[22m`;
		bar += "\x1b[39m";
		parts.push(bar);
	}
	if (opts.showStats !== false) {
		// Label wears pi's own footer-stats color so it reads as part of that run;
		// the threshold gradient still lives in the cells.
		const text = formatContextUsage(percent, contextWindow, opts.usedTokens);
		parts.push(opts.labelColor ? `${opts.labelColor}${text}\x1b[39m` : theme.fg("muted", text));
	}
	return parts.join(" ");
}
