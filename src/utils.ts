/**
 * Formatting helpers and the session-accent color algorithm, ported from
 * oh-my-pi (packages/utils/src/format.ts, packages/coding-agent/src/utils/
 * session-color.ts, tools/render-utils.ts, modes/shared.ts). Bun.color is
 * replaced with local hex math so this runs under any pi runtime.
 */
import { stripVTControlCharacters } from "node:util";
import { parseHex } from "./theme.js";

export function formatNumber(n: number): string {
	if (n < 1_000) return n.toString();
	if (n < 10_000) return `${(n / 1_000).toFixed(1)}K`;
	if (n < 1_000_000) return `${Math.round(n / 1_000)}K`;
	if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n < 1_000_000_000) return `${Math.round(n / 1_000_000)}M`;
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
 * Clamp a path/label to `maxLen` by eliding middle components with `…`.
 * The first folder (after `~` or the root) and the basename survive longest;
 * middle components drop farthest-from-cwd first. Falls back to plain
 * left-truncation once even `…/basename` overflows.
 */
export function clampPathLength(pwd: string, maxLen: number): string {
	if (pwd.length <= maxLen) return pwd;

	const parts = pwd.split("/");
	const last = parts.length - 1;
	const firstIdx = parts[0] === "" || parts[0] === "~" ? 1 : 0;

	for (let dropped = 1; dropped <= last - firstIdx - 1; dropped++) {
		const candidate = [...parts.slice(0, firstIdx + 1), "…", ...parts.slice(firstIdx + 1 + dropped)].join("/");
		if (candidate.length <= maxLen) return candidate;
	}

	// The first folder no longer fits: keep whatever remains closest to the cwd.
	for (let start = firstIdx + 1; start <= last; start++) {
		const candidate = `…/${parts.slice(start).join("/")}`;
		if (candidate.length <= maxLen) return candidate;
	}

	return `…${pwd.slice(-Math.max(0, maxLen - 1))}`;
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

function hslToHex(h: number, s: number, l: number): string {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	let r = 0;
	let g = 0;
	let b = 0;
	if (h < 60) [r, g, b] = [c, x, 0];
	else if (h < 120) [r, g, b] = [x, c, 0];
	else if (h < 180) [r, g, b] = [0, c, x];
	else if (h < 240) [r, g, b] = [0, x, c];
	else if (h < 300) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];
	const toHex = (v: number) =>
		Math.round((v + m) * 255)
			.toString(16)
			.padStart(2, "0");
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
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
	return hslToHex(targetHue, ACCENT_SATURATION, ACCENT_DARK_LIGHTNESS);
}
