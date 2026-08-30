/**
 * Settings persistence. Pi has no per-extension settings store, so the
 * statusline settings live in a small JSON at
 * ~/.pi/agent/pi-topping-statusline/settings.json.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { theme, type BorderStyle, type SymbolPreset } from "./theme.js";
import type {
	EffectiveStatusLineSettings,
	FeedFormat,
	SegmentIncludes,
	StatusLineFeed,
	StatusLineSegmentId,
	StatusLineSegmentToggles,
	StatusLineSeparatorStyle,
	StatusLineSettings,
} from "./types.js";

const SETTINGS_PATH = path.join(getAgentDir(), "pi-topping-statusline", "settings.json");

export const SEPARATORS: readonly StatusLineSeparatorStyle[] = ["powerline", "powerline-thin", "slash", "pipe", "ascii"];
const SYMBOL_PRESETS: SymbolPreset[] = ["nerd", "unicode", "ascii"];
export const BORDER_STYLES: readonly BorderStyle[] = ["rounded", "heavy", "double", "single"];

export const FEED_FORMATS: readonly FeedFormat[] = ["currency", "number", "text"];

/**
 * Seeded with pi-prompt-cache's published savings feed, so the segment works
 * as soon as it is switched on and doubles as a worked example of the shape.
 */
export const DEFAULT_FEEDS: readonly StatusLineFeed[] = [
	{ customType: "pi-prompt-cache/savings", field: "savedUsd", prefix: "CS", format: "currency" },
];

export const DEFAULT_SEGMENTS: Required<StatusLineSegmentToggles> = {
	pi: true,
	model: true,
	provider: false,
	thinking: true,
	path: true,
	git: true,
	pr: true,
	sessionName: true,
	tokenRateTopRight: false,
	piStats: true,
	tokenRate: false,
	feeds: false,
	feedsBottomLeft: false,
	tokenRateBottomLeft: false,
	contextBar: true,
	contextStats: true,
	scrollHint: true,
};

const SEGMENT_KEYS = Object.keys(DEFAULT_SEGMENTS) as (keyof StatusLineSegmentToggles)[];

/** Keep only well-formed rows; a feed without a customType or field can render nothing. */
export function sanitizeFeeds(raw: unknown): StatusLineFeed[] {
	if (!Array.isArray(raw)) return [];
	const feeds: StatusLineFeed[] = [];
	for (const item of raw) {
		if (!item || typeof item !== "object") continue;
		const { customType, field, prefix, format } = item as Record<string, unknown>;
		if (typeof customType !== "string" || typeof field !== "string") continue;
		if (!customType.trim() || !field.trim()) continue;
		feeds.push({
			customType: customType.trim(),
			field: field.trim(),
			prefix: typeof prefix === "string" ? prefix : "",
			format: FEED_FORMATS.includes(format as FeedFormat) ? (format as FeedFormat) : "text",
		});
	}
	return feeds;
}

function loadSettings(): StatusLineSettings {
	try {
		const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")) as StatusLineSettings;
		const settings: StatusLineSettings = {};
		if (typeof raw.transparent === "boolean") settings.transparent = raw.transparent;
		if (raw.separator && SEPARATORS.includes(raw.separator)) settings.separator = raw.separator;
		if (raw.symbols && SYMBOL_PRESETS.includes(raw.symbols)) settings.symbols = raw.symbols;
		if (raw.borderStyle && BORDER_STYLES.includes(raw.borderStyle)) settings.borderStyle = raw.borderStyle;
		if (raw.segments && typeof raw.segments === "object") {
			const segments: StatusLineSegmentToggles = {};
			for (const key of SEGMENT_KEYS) {
				if (typeof raw.segments[key] === "boolean") segments[key] = raw.segments[key];
			}
			settings.segments = segments;
		}
		if (raw.feeds !== undefined) settings.feeds = sanitizeFeeds(raw.feeds);
		if (typeof raw.rainbowBorder === "boolean") settings.rainbowBorder = raw.rainbowBorder;
		if (typeof raw.rainbowAnimation === "boolean") settings.rainbowAnimation = raw.rainbowAnimation;
		return settings;
	} catch {
		// Missing or corrupt settings.json falls back to defaults.
		return {};
	}
}

/** Atomic write; throws so callers can surface the failure. */
export function saveSettings(settings: StatusLineSettings): void {
	fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
	fs.writeFileSync(`${SETTINGS_PATH}.tmp`, `${JSON.stringify(settings, null, "\t")}\n`, { mode: 0o600 });
	fs.renameSync(`${SETTINGS_PATH}.tmp`, SETTINGS_PATH);
	fs.chmodSync(SETTINGS_PATH, 0o600);
}

export function resolveEffectiveSettings(settings: StatusLineSettings): EffectiveStatusLineSettings {
	const seg = { ...DEFAULT_SEGMENTS, ...settings.segments };

	const leftSegments: StatusLineSegmentId[] = [];
	if (seg.pi) leftSegments.push("pi");
	if (seg.model || seg.provider || seg.thinking) leftSegments.push("model");
	if (seg.path) leftSegments.push("path");
	if (seg.git) leftSegments.push("git");
	if (seg.pr) leftSegments.push("pr");

	const bottomRightSegments: StatusLineSegmentId[] = [];
	if (seg.feeds) bottomRightSegments.push("feeds");
	if (seg.tokenRate) bottomRightSegments.push("token_rate");
	if (seg.piStats) bottomRightSegments.push("pi_stats");
	if (seg.contextBar || seg.contextStats) bottomRightSegments.push("context_graph");

	const rightSegments: StatusLineSegmentId[] = [];
	// The rate leads so its width changes never shift the session name.
	if (seg.tokenRateTopRight) rightSegments.push("token_rate");
	if (seg.sessionName) rightSegments.push("session_name");

	const bottomLeftSegments: StatusLineSegmentId[] = [];
	if (seg.scrollHint) bottomLeftSegments.push("scroll_hint");
	if (seg.feedsBottomLeft) bottomLeftSegments.push("feeds");
	if (seg.tokenRateBottomLeft) bottomLeftSegments.push("token_rate");

	const feeds = settings.feeds ? sanitizeFeeds(settings.feeds) : [...DEFAULT_FEEDS];
	const allSegments = [...leftSegments, ...rightSegments, ...bottomLeftSegments, ...bottomRightSegments];
	const includes: SegmentIncludes = {
		git: allSegments.includes("git"),
		pr: allSegments.includes("pr"),
		piStats: allSegments.includes("pi_stats"),
		tokenRate: allSegments.includes("token_rate"),
		feeds: allSegments.includes("feeds") ? feeds.map(feed => feed.customType) : [],
	};

	return {
		transparent: settings.transparent ?? true,
		separator: settings.separator ?? "powerline-thin",
		symbols: settings.symbols ?? "nerd",
		borderStyle: settings.borderStyle ?? "rounded",
		leftSegments,
		rightSegments,
		bottomLeftSegments,
		bottomRightSegments,
		rainbowBorder: settings.rainbowBorder ?? true,
		rainbowAnimation: settings.rainbowAnimation ?? true,
		includes,
		segmentOptions: {
			model: { showModel: seg.model, showProvider: seg.provider, showThinking: seg.thinking },
			path: { abbreviate: true, maxLength: 40, stripWorkPrefix: true },
			context: { showBar: seg.contextBar, showStats: seg.contextStats },
			feeds,
		},
	};
}

export interface SettingsState {
	settings: StatusLineSettings;
	effective: EffectiveStatusLineSettings;
}

export function applySettings(state: SettingsState, settings: StatusLineSettings): void {
	state.settings = settings;
	state.effective = resolveEffectiveSettings(settings);
	theme.setSymbolPreset(state.effective.symbols);
}

export function createSettingsState(): SettingsState {
	const settings = loadSettings();
	const effective = resolveEffectiveSettings(settings);
	theme.setSymbolPreset(effective.symbols);
	return { settings, effective };
}
