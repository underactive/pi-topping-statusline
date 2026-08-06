/**
 * Ported from oh-my-pi status-line/types.ts, trimmed to the fields a pi
 * extension can populate. SegmentContext is a plain snapshot; segments are
 * pure functions over it.
 */
import type { BorderStyle, SymbolPreset } from "./theme.js";

export type StatusLineSeparatorStyle = "powerline" | "powerline-thin" | "slash" | "pipe" | "ascii";

export type StatusLineSegmentId =
	| "pi"
	| "model"
	| "path"
	| "git"
	| "pr"
	| "session_name"
	| "pi_stats"
	| "token_rate"
	| "feeds"
	| "context_graph"
	| "scroll_hint";

/**
 * A feed the statusline subscribes to: custom session entries published by
 * another extension under `customType`, as pi-prompt-cache does with
 * "pi-prompt-cache/savings". `field` names the property of the entry's data
 * object to display, and `prefix` is the literal label drawn before it.
 */
export interface StatusLineFeed {
	customType: string;
	field: string;
	prefix: string;
	format: FeedFormat;
}

/**
 * currency keeps the rules pi-prompt-cache's author specified for the savings
 * figure: a signed half-cent floor so this segment and that extension's own
 * footer never disagree, two decimals below $100 and whole dollars above.
 */
export type FeedFormat = "currency" | "number" | "text";

export interface StatusLineSegmentToggles {
	pi?: boolean;
	model?: boolean;
	provider?: boolean;
	thinking?: boolean;
	path?: boolean;
	git?: boolean;
	pr?: boolean;
	sessionName?: boolean;
	tokenRateTopRight?: boolean;
	piStats?: boolean;
	tokenRate?: boolean;
	feeds?: boolean;
	feedsBottomLeft?: boolean;
	tokenRateBottomLeft?: boolean;
	contextBar?: boolean;
	contextStats?: boolean;
	scrollHint?: boolean;
}

/** On-disk shape of ~/.pi/agent/pi-topping-statusline/settings.json. */
export interface StatusLineSettings {
	/** Drop the bar's bg fill and round caps so it inherits the terminal bg. */
	transparent?: boolean;
	separator?: StatusLineSeparatorStyle;
	symbols?: SymbolPreset;
	borderStyle?: BorderStyle;
	segments?: StatusLineSegmentToggles;
	feeds?: StatusLineFeed[];
	/** Animated rainbow border while the thinking level is max. */
	rainbowBorder?: boolean;
}

/** Resolved per-segment render options; resolveEffectiveSettings always fills them. */
export interface StatusLineSegmentOptions {
	model: { showModel: boolean; showProvider: boolean; showThinking: boolean };
	path: { abbreviate: boolean; maxLength: number; stripWorkPrefix: boolean };
	context: { showBar: boolean; showStats: boolean };
	/** Subscriptions rendered by the feeds segment, in display order. */
	feeds: StatusLineFeed[];
}

/** Which segment groups a build() snapshot needs to populate. */
export interface SegmentIncludes {
	git: boolean;
	pr: boolean;
	piStats: boolean;
	tokenRate: boolean;
	feeds: readonly string[];
}

export interface EffectiveStatusLineSettings {
	transparent: boolean;
	separator: StatusLineSeparatorStyle;
	symbols: SymbolPreset;
	borderStyle: BorderStyle;
	leftSegments: StatusLineSegmentId[];
	rightSegments: StatusLineSegmentId[];
	bottomLeftSegments: StatusLineSegmentId[];
	bottomRightSegments: StatusLineSegmentId[];
	segmentOptions: StatusLineSegmentOptions;
	rainbowBorder: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Segment rendering
// ═══════════════════════════════════════════════════════════════════════════

export interface SegmentContext {
	options: StatusLineSegmentOptions;
	model: { name?: string; id: string; provider: string; reasoning: boolean } | undefined;
	thinkingLevel: string;
	cwd: string;
	sessionName: string | undefined;
	/** Context usage percent, or null when unknown (e.g. right after compaction). */
	contextPercent: number | null;
	contextTokens: number;
	contextWindow: number;
	git: {
		branch: string | null;
		status: { staged: number; unstaged: number; untracked: number } | null;
		pr: { number: number; url: string } | null;
	};
	/** Set when cwd is a linked git worktree; path segment collapses to project name. */
	worktree: { projectName: string; worktreeName: string } | null;
	/** Scroll hint extracted from the editor's lower border, if present. */
	scrollHint: string | undefined;
	/** Pi's own footer stats, when this frame needs them. */
	piStats: string | undefined;
	/** Live tok/s display state, when this frame needs it. */
	tokenRate: TokenRateDisplay | undefined;
	/**
	 * Newest in-run data payload per subscribed customType. A customType is
	 * absent when no extension publishes it, or when it has published nothing
	 * since this run began — a resumed session still carries the previous run's
	 * entries, and those must not be shown as current.
	 */
	feedData: Record<string, unknown> | undefined;
}

export type TokenRatePhase = "active" | "fading" | "idle";

export interface TokenRateDisplay {
	/** Smoothed rate at last token arrival; null when idle (segment shows `---`). */
	rate: number | null;
	phase: TokenRatePhase;
	/** Discrete fade step (0..FADE_SHADE_COUNT-1); only meaningful when fading. */
	fadeShade: number;
}

export interface RenderedSegment {
	content: string;
	visible: boolean;
}

export interface StatusLineSegment {
	id: StatusLineSegmentId;
	render(ctx: SegmentContext): RenderedSegment;
}

export interface SeparatorDef {
	left: string;
	right: string;
}
