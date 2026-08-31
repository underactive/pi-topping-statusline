/**
 * Formatting helpers and the session-accent color algorithm, ported from
 * oh-my-pi (packages/utils/src/format.ts, packages/coding-agent/src/utils/
 * session-color.ts, tools/render-utils.ts, modes/shared.ts). Bun.color is
 * replaced with local hex math so this runs under any pi runtime.
 */
import { stripVTControlCharacters } from "node:util";
import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import { parseHex } from "./theme.js";
import { hslToRgb, rgbToHex } from "./rainbow.js";

export function formatNumber(n: number): string {
	if (n < 1_000) return n.toString();
	if (n < 10_000) return `${(n / 1_000).toFixed(1)}K`;
	if (n < 1_000_000) {
		const k = Math.round(n / 1_000);
		return k < 1000 ? `${k}K` : `${(n / 1_000_000).toFixed(1)}M`;
	}
	if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n < 1_000_000_000) {
		const m = Math.round(n / 1_000_000);
		return m < 1000 ? `${m}M` : `${(n / 1_000_000_000).toFixed(1)}B`;
	}
	if (n < 10_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
	return `${Math.round(n / 1_000_000_000)}B`;
}

export function shortenPath(filePath: string, homeDir?: string): string {
	const home = homeDir ?? process.env.HOME ?? "";
	if (home && filePath.startsWith(home)) {
		const suffix = filePath.slice(home.length);
		if (suffix === "" || suffix.startsWith("/")) return `~${suffix}`;
	}
	return filePath;
}

/**
 * Clamp a path/label to `maxLen` display cells by eliding middle components
 * with `…`. The first folder (after `~` or the root) and the basename survive
 * longest; middle components drop farthest-from-cwd first. Falls back to plain
 * left-truncation once even `…/basename` overflows. Widths are terminal cells
 * (matching layout.ts's visibleWidth budgets), not UTF-16 units.
 */
export function clampPathLength(pwd: string, maxLen: number): string {
	if (visibleWidth(pwd) <= maxLen) return pwd;

	const parts = pwd.split("/");
	const last = parts.length - 1;
	const firstIdx = parts[0] === "" || parts[0] === "~" ? 1 : 0;

	for (let dropped = 1; dropped <= last - firstIdx - 1; dropped++) {
		const candidate = [...parts.slice(0, firstIdx + 1), "…", ...parts.slice(firstIdx + 1 + dropped)].join("/");
		if (visibleWidth(candidate) <= maxLen) return candidate;
	}

	// The first folder no longer fits: keep whatever remains closest to the cwd.
	for (let start = firstIdx + 1; start <= last; start++) {
		const candidate = `…/${parts.slice(start).join("/")}`;
		if (visibleWidth(candidate) <= maxLen) return candidate;
	}

	const tailWidth = Math.max(0, maxLen - 1);
	return `…${sliceByColumn(pwd, visibleWidth(pwd) - tailWidth, tailWidth)}`;
}

/** Strip ANSI/VT escapes, map control chars to spaces, collapse whitespace. */
export function sanitizeStatusText(text: string): string {
	return stripVTControlCharacters(text)
		.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/**
 * Same safety as {@link sanitizeStatusText} but without trimming, so a label
 * written as "TOK " keeps the space that separates it from its value.
 */
export function sanitizeLabel(text: string): string {
	return stripVTControlCharacters(text)
		.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
		.replace(/ +/g, " ");
}

export function withIcon(icon: string, text: string): string {
	return icon ? `${icon} ${text}` : text;
}

/** Unambiguous identity for one configured field of a feed publisher. */
export function feedKey(customType: string, field: string): string {
	return `${customType}\u0000${field}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Session accent (djb2 hue hash, dark warm band, collision avoidance)
// ═══════════════════════════════════════════════════════════════════════════

function nameToHue(name: string): number {
	let hash = 5381;
	for (let i = 0; i < name.length; i++) {
		hash = ((hash << 5) + hash) ^ name.charCodeAt(i);
		hash = hash >>> 0;
	}
	return hash % 360;
}

const ACCENT_SATURATION = 0.9;
const ACCENT_DARK_LIGHTNESS = 0.72;
const MIN_HUE_DISTANCE = 10;
const MIN_SATURATION_FOR_HUE = 0.1;
const DARK_HUE_START = 0;
const DARK_HUE_END = 120;

function hueDistance(a: number, b: number): number {
	const d = Math.abs(a - b);
	return Math.min(d, 360 - d);
}

function hexToHue(hex: string): number | undefined {
	const rgb = parseHex(hex);
	if (!rgb) return undefined;
	const r = rgb[0] / 255;
	const g = rgb[1] / 255;
	const b = rgb[2] / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;
	const s = max === 0 ? 0 : delta / max;
	if (s < MIN_SATURATION_FOR_HUE) return undefined;
	let h: number;
	if (delta === 0) h = 0;
	else if (max === r) h = 60 * (((g - b) / delta) % 6);
	else if (max === g) h = 60 * ((b - r) / delta + 2);
	else h = 60 * ((r - g) / delta + 4);
	return (h + 360) % 360;
}

function findSafeHue(target: number, occupied: number[], lo: number, hi: number): number {
	if (occupied.length === 0) return target;
	if (occupied.every(h => hueDistance(target, h) >= MIN_HUE_DISTANCE)) return target;
	for (let d = 1; d <= hi - lo; d++) {
		for (const dir of [1, -1]) {
			const candidate = Math.max(lo, Math.min(hi, target + d * dir));
			if (occupied.every(h => hueDistance(candidate, h) >= MIN_HUE_DISTANCE)) return candidate;
		}
	}
	return target;
}

/** Stable accent hex for a session name (OMP's dark-theme path). */
export function getSessionAccentHex(name: string, themeColorHexes: string[]): string {
	const range = DARK_HUE_END - DARK_HUE_START;
	let targetHue = DARK_HUE_START + (nameToHue(name) % range);
	const themeHues = themeColorHexes.map(hexToHue).filter((h): h is number => h !== undefined);
	targetHue = findSafeHue(targetHue, themeHues, DARK_HUE_START, DARK_HUE_END);
	return rgbToHex(hslToRgb(targetHue, ACCENT_SATURATION, ACCENT_DARK_LIGHTNESS));
}
