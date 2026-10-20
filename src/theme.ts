/**
 * Statusline theme: symbol sets + palette ported from oh-my-pi.
 *
 * Symbols: packages/coding-agent/src/modes/theme/theme.ts (UNICODE/NERD/ASCII maps)
 * Palette: packages/coding-agent/src/modes/theme/dark.json (statusLine* roles)
 *
 * Pi's Theme has no statusLine* color roles, so the OMP dark palette is
 * embedded here. Values are hex strings (truecolor), 256-palette indices
 * (numbers), or "" for the terminal default color.
 */
import { getTerminalColorMode, type TerminalColorMode } from "@earendil-works/pi-tui";
import { easeFade, FADE_SHADE_COUNT } from "@underactive/pi-topping-primitives/activity";
import {
	channelsToFgAnsi,
	fadeRgbToward,
	hexToFgAnsi as sharedHexToFgAnsi,
	parseHex,
	xterm256ToRgb,
} from "@underactive/pi-topping-primitives/color";
import { ASCII_BOX, BOX_STYLES, type BoxGlyphs, type BoxStyle } from "@underactive/pi-topping-primitives/glyphs";

export type { BoxGlyphs };

export type SymbolPreset = "unicode" | "nerd" | "ascii";

export type BorderStyle = BoxStyle;

export interface StatusSymbols {
	sep: {
		powerlineLeft: string;
		powerlineRight: string;
		powerlineThinLeft: string;
		powerlineThinRight: string;
		halfCircleLeft: string;
		halfCircleRight: string;
		asciiLeft: string;
		asciiRight: string;
		dot: string;
		slash: string;
		pipe: string;
	};
	icon: {
		pi: string;
		model: string;
		folder: string;
		scratchFolder: string;
		worktree: string;
		branch: string;
		pr: string;
	};
	thinking: {
		minimal: string;
		low: string;
		medium: string;
		high: string;
		xhigh: string;
		max: string;
	};
}

const UNICODE_SYMBOLS: StatusSymbols = {
	sep: {
		powerlineLeft: "▶",
		powerlineRight: "◀",
		powerlineThinLeft: ">",
		powerlineThinRight: "<",
		halfCircleLeft: "",
		halfCircleRight: "",
		asciiLeft: ">",
		asciiRight: "<",
		dot: " · ",
		slash: " / ",
		pipe: " │ ",
	},
	icon: {
		pi: "π",
		model: "⬢",
		folder: "📁",
		scratchFolder: "🗑",
		worktree: "🌳",
		branch: "⑂",
		pr: "⤴",
	},
	thinking: {
		minimal: "○ min",
		low: "◔ low",
		medium: "◑ med",
		high: "◒ high",
		xhigh: "◕ xhigh",
		max: "◉ max",
	},
};

const NERD_SYMBOLS: StatusSymbols = {
	sep: {
		powerlineLeft: "\ue0b0",
		powerlineRight: "\ue0b2",
		powerlineThinLeft: "\ue0b1",
		powerlineThinRight: "\ue0b3",
		halfCircleLeft: "\ue0b6",
		halfCircleRight: "\ue0b4",
		asciiLeft: ">",
		asciiRight: "<",
		dot: " · ",
		slash: "\ue0bb",
		pipe: "│",
	},
	icon: {
		pi: "\ue22c",
		model: "\uec19",
		folder: "\uf115",
		scratchFolder: "\uf014",
		worktree: "\uf0e8",
		branch: "\uf126",
		pr: "\uea64",
	},
	thinking: {
		minimal: "\u{f0a9e} min",
		low: "\u{f0a9f} low",
		medium: "\u{f0aa1} med",
		high: "\u{f0aa3} high",
		xhigh: "\u{f0aa5} xhigh",
		max: "\u{f06d} max",
	},
};

const ASCII_SYMBOLS: StatusSymbols = {
	sep: {
		powerlineLeft: ">",
		powerlineRight: "<",
		powerlineThinLeft: ">",
		powerlineThinRight: "<",
		halfCircleLeft: "",
		halfCircleRight: "",
		asciiLeft: ">",
		asciiRight: "<",
		dot: " - ",
		slash: " / ",
		pipe: " | ",
	},
	icon: {
		pi: "pi",
		model: "[M]",
		folder: "[D]",
		scratchFolder: "[T]",
		worktree: "[wt]",
		branch: "@",
		pr: "PR",
	},
	thinking: {
		minimal: "[min]",
		low: "[low]",
		medium: "[med]",
		high: "[high]",
		xhigh: "[xhigh]",
		max: "[max]",
	},
};

const SYMBOL_PRESETS: Record<SymbolPreset, StatusSymbols> = {
	unicode: UNICODE_SYMBOLS,
	nerd: NERD_SYMBOLS,
	ascii: ASCII_SYMBOLS,
};

// ═══════════════════════════════════════════════════════════════════════════
// Palette (OMP dark.json)
// ═══════════════════════════════════════════════════════════════════════════

type ColorValue = string | number;

export type StatusColor =
	| "accent"
	| "error"
	| "warning"
	| "muted"
	| "dim"
	| "text"
	| "statusLineSep"
	| "statusLineModel"
	| "statusLinePath"
	| "statusLineGitClean"
	| "statusLineGitDirty"
	| "statusLineContext"
	| "statusLineContextElevated"
	| "statusLineCacheHit"
	| "statusLineStaged"
	| "statusLineDirty"
	| "statusLineUntracked"
	| "statusLineBg";

const STATUS_LINE_BG: ColorValue = "#121212";

const FG_COLORS: Record<StatusColor, ColorValue> = {
	accent: "#febc38",
	error: "#fc3a4b",
	warning: "#e4c00f",
	muted: "#777d88",
	dim: "#5f6673",
	text: "",
	statusLineSep: 244,
	statusLineModel: "#d787af",
	statusLinePath: "#00afaf",
	statusLineGitClean: "#5faf5f",
	statusLineGitDirty: "#d7af5f",
	statusLineContext: "#8787af",
	statusLineContextElevated: "#e07a1f",
	statusLineCacheHit: "#7fb069",
	statusLineStaged: 70,
	statusLineDirty: 178,
	statusLineUntracked: 39,
	statusLineBg: STATUS_LINE_BG,
};

/** Dominant palette hexes the session accent must not collide with. */
export const MAJOR_COLOR_HEXES = [
	"#febc38",
	"#89d281",
	"#fc3a4b",
	"#e4c00f",
	"#b281d6",
	"#d787af",
	"#00afaf",
];

export type ColorMode = TerminalColorMode;

/** Defer to pi's cached terminal detection, which honors PI_TRUE_COLOR, terminal.trueColor, and capability overrides. */
export function detectColorMode(): ColorMode {
	return getTerminalColorMode();
}

export { easeFade, FADE_SHADE_COUNT } from "@underactive/pi-topping-primitives/activity";

function colorValueToRgb(color: ColorValue): [number, number, number] {
	if (typeof color === "number") return xterm256ToRgb(color);
	return parseHex(color) ?? [0, 0, 0];
}

/** The bar background as a tuple, resolved once at load: `fadeAnsi` sinks colours toward it on every tick. */
const STATUS_LINE_BG_RGB = colorValueToRgb(STATUS_LINE_BG);

/** `#rrggbb` as a foreground escape, in the terminal's colour depth unless the caller passes one. */
export function hexToFgAnsi(hex: string, mode: ColorMode = detectColorMode()): string {
	return sharedHexToFgAnsi(hex, mode);
}

function fgAnsi(color: ColorValue, mode: ColorMode): string {
	if (color === "") return "\x1b[39m";
	if (typeof color === "number") return `\x1b[38;5;${color}m`;
	return sharedHexToFgAnsi(color, mode);
}

function bgAnsi(color: ColorValue, mode: ColorMode): string {
	if (color === "") return "\x1b[49m";
	if (typeof color === "number") return `\x1b[48;5;${color}m`;
	return fgAnsi(color, mode).replace("\x1b[38;", "\x1b[48;");
}

// ═══════════════════════════════════════════════════════════════════════════
// Theme singleton
// ═══════════════════════════════════════════════════════════════════════════

class StatusTheme {
	#mode: ColorMode | undefined;
	#preset: SymbolPreset = "nerd";
	#symbols: StatusSymbols = NERD_SYMBOLS;
	#fgCache = new Map<StatusColor, string>();
	#bgAnsi: string | undefined;

	/**
	 * Pi imports extensions before it applies terminal.trueColor and reapplies
	 * overrides when settings change, so resolve the mode on use and drop stale ANSI.
	 */
	#currentMode(): ColorMode {
		const mode = detectColorMode();
		if (mode !== this.#mode) {
			this.#mode = mode;
			this.#fgCache.clear();
			this.#bgAnsi = undefined;
		}
		return mode;
	}

	setSymbolPreset(preset: SymbolPreset): SymbolPreset {
		const previous = this.#preset;
		this.#preset = preset;
		this.#symbols = SYMBOL_PRESETS[preset];
		return previous;
	}

	get sep(): StatusSymbols["sep"] {
		return this.#symbols.sep;
	}

	get icon(): StatusSymbols["icon"] {
		return this.#symbols.icon;
	}

	get thinking(): StatusSymbols["thinking"] {
		return this.#symbols.thinking;
	}

	/** The ascii preset overrides every border style with its plain-text box. */
	getBox(style: BorderStyle): BoxGlyphs {
		return this.#preset === "ascii" ? ASCII_BOX : BOX_STYLES[style];
	}

	getFgAnsi(color: StatusColor): string {
		const mode = this.#currentMode();
		let ansi = this.#fgCache.get(color);
		if (ansi === undefined) {
			ansi = fgAnsi(FG_COLORS[color], mode);
			this.#fgCache.set(color, ansi);
		}
		return ansi;
	}

	getBgAnsi(): string {
		const mode = this.#currentMode();
		if (this.#bgAnsi === undefined) this.#bgAnsi = bgAnsi(STATUS_LINE_BG, mode);
		return this.#bgAnsi;
	}

	fg(color: StatusColor, text: string): string {
		return `${this.getFgAnsi(color)}${text}\x1b[39m`;
	}

	/**
	 * Render text in one fade shade between two palette roles, blending
	 * `from` toward `to` on an eased (raised-cosine) ramp. Ported from
	 * pi-topping's fadeWarningString, generalized over StatusColor pairs.
	 */
	fadeFg(from: StatusColor, to: StatusColor, shade: number, text: string): string {
		const clamped = Math.max(0, Math.min(FADE_SHADE_COUNT - 1, Math.floor(shade)));
		const progress = (clamped + 1) / FADE_SHADE_COUNT;
		const eased = easeFade(progress);
		const a = colorValueToRgb(FG_COLORS[from]);
		const b = colorValueToRgb(FG_COLORS[to]);
		const r = Math.round(a[0] * (1 - eased) + b[0] * eased);
		const g = Math.round(a[1] * (1 - eased) + b[1] * eased);
		const bl = Math.round(a[2] * (1 - eased) + b[2] * eased);
		const ansi = channelsToFgAnsi(r, g, bl, this.#currentMode());
		return `${ansi}${text}\x1b[39m`;
	}

	/**
	 * Blend every color already present in `text` toward the bar background
	 * by `opacity` (1 = untouched, 0 = fully sunk into the background), so a
	 * fully styled group can fade as a whole without re-rendering its segments.
	 * Default-foreground resets are recolored from a neutral stand-in so plain
	 * labels fade alongside their colored neighbors; background resets (49)
	 * stay put so transparent bars keep the terminal's own background.
	 */
	fadeAnsi(text: string, opacity: number): string {
		const alpha = Math.max(0, Math.min(1, opacity));
		if (alpha >= 1) return text;
		return fadeRgbToward(text, STATUS_LINE_BG_RGB, alpha, this.#currentMode());
	}
}

export const theme = new StatusTheme();
