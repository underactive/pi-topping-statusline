/** Provider-specific NVIDIA green border colorizer for Switchyard. */
import {
	isSwitchyardProvider,
	mixRgb,
	NVIDIA_GREEN_DARK_HEX,
	NVIDIA_GREEN_HEX,
	parseHex,
	rgbToFgAnsi,
	wrapDeg,
} from "@underactive/pi-topping-primitives/color";
import type { BorderColorizer } from "./rainbow.js";
import { detectColorMode, type ColorMode } from "./theme.js";

export { isSwitchyardProvider, NVIDIA_GREEN_DARK_HEX, NVIDIA_GREEN_HEX };

const GREEN_SHADE_COUNT = 256;
const GREEN_BIAS = 0.65;

const ansiByShadeByMode = new Map<ColorMode, string[]>();

function buildAnsiByShade(mode: ColorMode): string[] {
	const cached = ansiByShadeByMode.get(mode);
	if (cached !== undefined) return cached;

	const dark = parseHex(NVIDIA_GREEN_DARK_HEX);
	const bright = parseHex(NVIDIA_GREEN_HEX);
	if (dark === undefined || bright === undefined) {
		throw new Error("Invalid NVIDIA green palette");
	}

	const ansiByShade: string[] = [];
	for (let i = 0; i < GREEN_SHADE_COUNT; i++) {
		const progress = i / (GREEN_SHADE_COUNT - 1);
		const rgb = mixRgb(dark, bright, progress);
		ansiByShade.push(rgbToFgAnsi(rgb, mode));
	}

	ansiByShadeByMode.set(mode, ansiByShade);
	return ansiByShade;
}

export class NvidiaGreenBorder implements BorderColorizer {
	#phaseDeg: number;

	constructor(phaseDeg = 0) {
		this.#phaseDeg = wrapDeg(phaseDeg);
	}

	step(deltaDeg: number): void {
		this.#phaseDeg = wrapDeg(this.#phaseDeg + deltaDeg);
	}

	colorChar(char: string, perimeterPos: number, perimeter: number): string {
		return `${this.prefix(perimeterPos, perimeter)}${char}\x1b[39m`;
	}

	prefix(perimeterPos: number, perimeter: number): string {
		const t = (perimeterPos / perimeter + this.#phaseDeg / 360) % 1;
		const u = (1 - Math.cos(2 * Math.PI * t)) / 2;
		const eased = u ** GREEN_BIAS;
		const shadeIndex = Math.round((1 - eased) * (GREEN_SHADE_COUNT - 1));
		return buildAnsiByShade(detectColorMode())[shadeIndex];
	}
}
