/**
 * Shared box-chrome painting for the live editor box (index.ts) and the
 * settings-menu preview, so the 3/2/+2 row geometry has one definition.
 *
 * Rainbow mode colors each glyph by its perimeter-walk position; otherwise
 * the caller's flat painter wraps whole runs in one escape sequence, which
 * renders identically to per-glyph wraps with fewer bytes. The flat painter
 * and the RainbowBorder instance are injected because they differ per caller
 * (host borderColor vs menu theme; shared stepped animator vs phase-from-
 * elapsed instance).
 */
import { visibleWidth } from "@earendil-works/pi-tui";
import { perimeterLength, perimeterPosition, type RainbowBorder } from "./rainbow.js";
import type { BoxGlyphs } from "./theme.js";

export interface BoxPainters {
	paint(row: number, col: number, ch: string): string;
	horizRun(row: number, startCol: number, count: number): string;
	/** Signature matches buildStatusLine's gapBorderColor callback. */
	gapColor(str: string, startCol: number, row: number): string;
}

export function makeBoxPainters(opts: {
	rainbowOn: boolean;
	rainbow: RainbowBorder;
	box: BoxGlyphs;
	width: number;
	bottomIdx: number;
	flat: (str: string) => string;
}): BoxPainters {
	const { rainbowOn, rainbow, box, width, bottomIdx, flat } = opts;
	const perimeter = perimeterLength(width, bottomIdx);
	const paint = (row: number, col: number, ch: string): string =>
		rainbowOn ? rainbow.colorChar(ch, perimeterPosition(row, col, width, bottomIdx), perimeter) : flat(ch);
	const horizRun = (row: number, startCol: number, count: number): string => {
		if (!rainbowOn) return flat(box.horizontal.repeat(count));
		let out = "";
		for (let k = 0; k < count; k++) out += paint(row, startCol + k, box.horizontal);
		return out;
	};
	const gapColor = (str: string, startCol: number, row: number): string => {
		if (!rainbowOn) return flat(str);
		let out = "";
		let k = 0;
		for (const ch of str) out += paint(row, startCol + k++, ch);
		return out;
	};
	return { paint, horizRun, gapColor };
}

/** A bar row: corner, 2-cell run, the bar, a pad+2 run, corner — 6 cells of chrome. */
export function renderBoxRow(
	painters: BoxPainters,
	bar: string,
	rowIdx: number,
	boxWidth: number,
	leftGlyph: string,
	rightGlyph: string,
): string {
	const barWidth = visibleWidth(bar);
	const pad = Math.max(0, boxWidth - 6 - barWidth);
	return (
		painters.paint(rowIdx, 0, leftGlyph) +
		painters.horizRun(rowIdx, 1, 2) +
		bar +
		painters.horizRun(rowIdx, 3 + barWidth, pad + 2) +
		painters.paint(rowIdx, boxWidth - 1, rightGlyph)
	);
}
