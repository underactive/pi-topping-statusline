/**
 * Animated rainbow border for the max thinking level.
 *
 * Instead of painting the editor box border with the host's fixed
 * thinking-max theme token, the border glyphs get a full hue cycle (0–360°)
 * distributed around the box perimeter, with the whole spectrum rotating over
 * time — the border looks like a spectrum flowing around the screen, similar
 * to Apple Intelligence's border effect.
 *
 * The RainbowBorder class is a pure colorer: callers map glyphs to perimeter
 * positions with perimeterPosition(), then either step the phase each frame
 * (renderBoxed in index.ts) or construct a fresh instance with a phase
 * derived from elapsed time (the settings preview).
 */
import { detectColorMode, hexToFgAnsi, type ColorMode } from "./theme.js";

/** Frame cadence of the sweep (also the settings-preview refresh delay). */
export const RAINBOW_FRAME_MS = 50;
/** One full hue rotation around the border perimeter takes this long. */
export const RAINBOW_CYCLE_MS = 14_000;
/** Hue advance per frame tick. */
export const RAINBOW_DEG_PER_FRAME = (360 * RAINBOW_FRAME_MS) / RAINBOW_CYCLE_MS;

const SATURATION = 1;
const LIGHTNESS = 0.62;

/**
 * Number of border cells in the box (rows 0..bottomIdx, cols 0..width-1):
 * two horizontal edges of `width` cells plus two vertical edges of
 * `bottomIdx + 1` cells, minus the four corners counted twice.
 */
export function perimeterLength(width: number, bottomIdx: number): number {
	return 2 * width + 2 * bottomIdx - 2;
}

/**
 * Clockwise walk position of a box border cell, starting at the top-left
 * corner: top edge left→right, right edge top→bottom, bottom edge
 * right→left, left edge bottom→top. Consecutive cells along the walk get
 * consecutive positions, so the hue gradient stays continuous around the box.
 */
export function perimeterPosition(row: number, col: number, width: number, bottomIdx: number): number {
	if (row === 0) return col;
	if (row === bottomIdx) return 2 * width + bottomIdx - 2 - col;
	if (col === width - 1) return width - 1 + row;
	return 2 * width + 2 * bottomIdx - 2 - row; // col === 0
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	let rgb: [number, number, number];
	if (h < 60) rgb = [c, x, 0];
	else if (h < 120) rgb = [x, c, 0];
	else if (h < 180) rgb = [0, c, x];
	else if (h < 240) rgb = [0, x, c];
	else if (h < 300) rgb = [x, 0, c];
	else rgb = [c, 0, x];
	return [Math.round((rgb[0] + m) * 255), Math.round((rgb[1] + m) * 255), Math.round((rgb[2] + m) * 255)];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
	return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * Colors box glyphs with a hue that travels around the border perimeter as
 * the phase advances — the spectrum appears to flow around the box.
 */
export class RainbowBorder {
	#phaseDeg: number;
	readonly #mode: ColorMode;
	readonly #ansiByHue: string[] = [];

	constructor(phaseDeg = 0) {
		this.#phaseDeg = ((phaseDeg % 360) + 360) % 360;
		this.#mode = detectColorMode();
	}

	/** Advance the whole spectrum by `deltaDeg` (mod 360). */
	step(deltaDeg: number): void {
		this.#phaseDeg = ((this.#phaseDeg + deltaDeg) % 360 + 360) % 360;
	}

	/** Color one border glyph whose walk position is `perimeterPos` of `perimeter`. */
	colorChar(char: string, perimeterPos: number, perimeter: number): string {
		const hue = (this.#phaseDeg + (360 * perimeterPos) / perimeter) % 360;
		const bucket = Math.round(hue) % 360;
		let ansi = this.#ansiByHue[bucket];
		if (ansi === undefined) {
			const hex = rgbToHex(hslToRgb(bucket, SATURATION, LIGHTNESS));
			ansi = hexToFgAnsi(hex, this.#mode);
			this.#ansiByHue[bucket] = ansi;
		}
		return `${ansi}${char}\x1b[39m`;
	}
}
