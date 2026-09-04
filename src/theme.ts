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

export type SymbolPreset = "unicode" | "nerd" | "ascii";

export type BorderStyle = "rounded" | "heavy" | "double" | "single";

export interface BoxGlyphs {
	topLeft: string;
	topRight: string;
	bottomLeft: string;
	bottomRight: string;
	horizontal: string;
	vertical: string;
}

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

const ASCII_BOX: BoxGlyphs = { topLeft: "+", topRight: "+", bottomLeft: "+", bottomRight: "+", horizontal: "-", vertical: "|" };

/** Same glyphs as pi-topping's User Prompt border style. */
const BOX_STYLES: Record<BorderStyle, BoxGlyphs> = {
	rounded: { topLeft: "╭", topRight: "╮", bottomLeft: "╰", bottomRight: "╯", horizontal: "─", vertical: "│" },
	heavy: { topLeft: "┏", topRight: "┓", bottomLeft: "┗", bottomRight: "┛", horizontal: "━", vertical: "┃" },
	double: { topLeft: "╔", topRight: "╗", bottomLeft: "╚", bottomRight: "╝", horizontal: "═", vertical: "║" },
	single: { topLeft: "┌", topRight: "┐", bottomLeft: "└", bottomRight: "┘", horizontal: "─", vertical: "│" },
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

export type ColorMode = "truecolor" | "256color";

export function detectColorMode(): ColorMode {
	const colorterm = process.env.COLORTERM;
	if (colorterm === "truecolor" || colorterm === "24bit") return "truecolor";
	if (process.env.WT_SESSION) return "truecolor";
	const term = process.env.TERM || "";
	if (term === "dumb" || term === "" || term === "linux") return "256color";
	return "truecolor";
}

export function parseHex(hex: string): [number, number, number] | undefined {
	const match = /^#?([0-9a-f]{6})$/i.exec(hex);
	if (!match) return undefined;
	const n = Number.parseInt(match[1], 16);
	return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Number of discrete, eased shades used for the token-rate and feed fades (pi-topping). */
export const FADE_SHADE_COUNT = 5;

/** Stand-in for the terminal's default foreground when a fade must recolor it. */
const DEFAULT_FG_RGB: [number, number, number] = [204, 204, 204];

/** Every SGR color the layout or a segment can emit: truecolor, 256-color, or the default-fg reset. */
const SGR_COLOR_RE = /\x1b\[(38|48);2;(\d+);(\d+);(\d+)m|\x1b\[(38|48);5;(\d+)m|\x1b\[39m/g;

/** Raised-cosine ease shared by the discrete and continuous fades. */
export function easeFade(progress: number): number {
	const clamped = Math.max(0, Math.min(1, progress));
	return 0.5 * (1 - Math.cos(Math.PI * clamped));
}

/** Resolve an xterm-256 palette index to RGB (16–231 cube, 232–255 grayscale). */
function xterm256ToRgb(n: number): [number, number, number] {
	if (n >= 232) {
		const v = 8 + (n - 232) * 10;
		return [v, v, v];
	}
	const i = Math.max(0, n - 16);
	const c = (v: number) => (v === 0 ? 0 : 55 + v * 51);
	return [c(Math.floor(i / 36) % 6), c(Math.floor(i / 6) % 6), c(i % 6)];
}

function colorValueToRgb(color: ColorValue): [number, number, number] {
	if (typeof color === "number") return xterm256ToRgb(color);
	return parseHex(color) ?? [0, 0, 0];
}

function rgbTo256(r: number, g: number, b: number): number {
	if (r === g && g === b) {
		if (r < 8) return 16;
		if (r > 248) return 231;
		return 232 + Math.round(((r - 8) / 247) * 24);
	}
	const scale = (v: number) => Math.round((v / 255) * 5);
	return 16 + 36 * scale(r) + 6 * scale(g) + scale(b);
}

function rgbToFgAnsi(r: number, g: number, b: number, mode: ColorMode): string {
	return mode === "truecolor" ? `\x1b[38;2;${r};${g};${b}m` : `\x1b[38;5;${rgbTo256(r, g, b)}m`;
}

export function hexToFgAnsi(hex: string, mode: ColorMode = detectColorMode()): string {
	const rgb = parseHex(hex);
	if (!rgb) return "";
	return rgbToFgAnsi(...rgb, mode);
}

function fgAnsi(color: ColorValue, mode: ColorMode): string {
	if (color === "") return "\x1b[39m";
	if (typeof color === "number") return `\x1b[38;5;${color}m`;
	return hexToFgAnsi(color, mode);
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
	#mode: ColorMode = detectColorMode();
	#preset: SymbolPreset = "nerd";
	#symbols: StatusSymbols = NERD_SYMBOLS;
	#fgCache = new Map<StatusColor, string>();
	#bgAnsi: string | undefined;

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
		let ansi = this.#fgCache.get(color);
		if (ansi === undefined) {
			ansi = fgAnsi(FG_COLORS[color], this.#mode);
			this.#fgCache.set(color, ansi);
		}
		return ansi;
	}

	getBgAnsi(): string {
		if (this.#bgAnsi === undefined) this.#bgAnsi = bgAnsi(STATUS_LINE_BG, this.#mode);
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
		const ansi = rgbToFgAnsi(r, g, bl, this.#mode);
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
		const target = colorValueToRgb(STATUS_LINE_BG);
		const mode = this.#mode;
		return text.replace(SGR_COLOR_RE, (_m, tcPlane, r, g, b, ixPlane, index) => {
			let plane = "38";
			let rgb: [number, number, number] = DEFAULT_FG_RGB;
			if (tcPlane) {
				plane = tcPlane;
				rgb = [Number(r), Number(g), Number(b)];
			} else if (ixPlane) {
				plane = ixPlane;
				rgb = xterm256ToRgb(Number(index));
			}
			const mix = (i: number) => Math.round(rgb[i] * alpha + target[i] * (1 - alpha));
			const fg = rgbToFgAnsi(mix(0), mix(1), mix(2), mode);
			return plane === "38" ? fg : fg.replace("\x1b[38;", "\x1b[48;");
		});
	}
}

export const theme = new StatusTheme();
