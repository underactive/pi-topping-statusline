/**
 * The compaction bar, drawn with the same cells and trough glyphs as the context graph.
 */
import { CELLS, FILLED, TROUGH } from "./context-graph.js";
import { detectColorMode, mixRgb, rgbToFgAnsi } from "./theme.js";
import type { ColorMode } from "./theme.js";

const COMET_SWEEP_MS = 2_000;
const COMET_START_PADDING_CELLS = 2;
const COMET_END_PADDING_CELLS = 6;
const COMET_HALF_WIDTH_CELLS = 1.5;
const COMET_TRAIL_DECAY_CELLS = 3.2;

const DEEP_GREEN: readonly [number, number, number] = [11, 61, 32];
const BASE_GREEN: readonly [number, number, number] = [114, 241, 184];
const LIGHT_GREEN: readonly [number, number, number] = [185, 248, 217];
const TROUGH_GREEN: readonly [number, number, number] = [38, 100, 70];

function cosineFalloff(distance: number, halfWidth: number): number {
	if (distance >= halfWidth) return 0;
	return 0.5 * (1 + Math.cos((Math.PI * distance) / halfWidth));
}

function normalizeElapsedMs(elapsedMs: number | undefined): number {
	return Number.isFinite(elapsedMs) && elapsedMs !== undefined && elapsedMs > 0 ? elapsedMs : 0;
}

function renderCometCell(position: number, filled: number, elapsedMs: number, mode: ColorMode): string {
	const phase = (elapsedMs % COMET_SWEEP_MS) / COMET_SWEEP_MS;
	const head = filled + COMET_START_PADDING_CELLS - phase * (filled + COMET_END_PADDING_CELLS);
	const behind = position - head;
	const trail = behind >= 0 ? Math.exp(-behind / COMET_TRAIL_DECAY_CELLS) : 0;
	const crest = cosineFalloff(Math.abs(position - head), COMET_HALF_WIDTH_CELLS);
	const intensity = Math.min(1, Math.max(trail * 0.82, crest));
	const trailBase = mixRgb(DEEP_GREEN, BASE_GREEN, 0.62 + 0.38 * trail);
	const color = mixRgb(trailBase, LIGHT_GREEN, intensity * 0.9);
	const emphasized = crest > 0.25;
	return `${emphasized ? "\x1b[1m" : ""}${rgbToFgAnsi(...color, mode)}${FILLED}${emphasized ? "\x1b[22m" : ""}`;
}

export function renderCompactionBar(
	percent: number,
	opts: { mode?: ColorMode; shimmerElapsedMs?: number } = {},
): string {
	const mode = opts.mode ?? detectColorMode();
	const clamped = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
	const filled = Math.min(CELLS, Math.max(0, Math.round((clamped * CELLS) / 100)));
	const elapsedMs = normalizeElapsedMs(opts.shimmerElapsedMs);
	let bar = "";
	for (let i = 0; i < filled; i++) {
		bar += renderCometCell(i, filled, elapsedMs, mode);
	}
	if (filled < CELLS) {
		bar += `\x1b[39m\x1b[2m${rgbToFgAnsi(...TROUGH_GREEN, mode)}${TROUGH.repeat(CELLS - filled)}\x1b[22m`;
	}
	bar += "\x1b[39m";
	return bar;
}
