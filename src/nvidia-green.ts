/** Provider-specific NVIDIA green border colorizer for Switchyard. */
import { rgbToHex, wrapDeg, type BorderColorizer } from "./rainbow.js";
import { detectColorMode, hexToFgAnsi, parseHex, type ColorMode } from "./theme.js";

export const SWITCHYARD_PROVIDER = "switchyard";
export const NVIDIA_GREEN_HEX = "#84c51a";
export const NVIDIA_GREEN_DARK_HEX = "#0b3d20";
const GREEN_SHADE_COUNT = 256;
const GREEN_BIAS = 0.65;

export function isSwitchyardProvider(provider: string | undefined): boolean {
	return provider?.trim().toLowerCase() === SWITCHYARD_PROVIDER;
}

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
		const rgb: [number, number, number] = [
			Math.round(dark[0] + (bright[0] - dark[0]) * progress),
			Math.round(dark[1] + (bright[1] - dark[1]) * progress),
			Math.round(dark[2] + (bright[2] - dark[2]) * progress),
		];
		ansiByShade.push(hexToFgAnsi(rgbToHex(rgb), mode));
	}

	ansiByShadeByMode.set(mode, ansiByShade);
	return ansiByShade;
}

export class NvidiaGreenBorder implements BorderColorizer {
	#phaseDeg: number;
	readonly #ansiByShade: string[];

	constructor(phaseDeg = 0) {
		this.#phaseDeg = wrapDeg(phaseDeg);
		this.#ansiByShade = buildAnsiByShade(detectColorMode());
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
		return this.#ansiByShade[shadeIndex];
	}
}
