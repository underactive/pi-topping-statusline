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
	| "cache_hit_graph"
	| "context_graph"
	| "scroll_hint"
	| "working"
	| "compaction_info"
	| "compaction_graph";

/**
 * A feed the statusline subscribes to: custom session entries published by
 * another extension under `customType`, for example
 * `pi.appendEntry("my-extension/savings", { savedUsd })`. `field` names the property of the entry's data
 * object to display, and `prefix` is the literal label drawn before it.
 */
export interface StatusLineFeed {
	customType: string;
	field: string;
	prefix: string;
	format: FeedFormat;
}

/**
 * currency keeps the rules specified for the savings figure this format was written
 * for (published by pi-topping-compact, a private extension): a signed half-cent
 * floor, two decimals below $100 and whole dollars above.
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
	cacheHitBar?: boolean;
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
	/** Rainbow border while the thinking level is max. */
	rainbowBorder?: boolean;
	/** Animate the rainbow border when it is visible. */
	rainbowAnimation?: boolean;
	/** NVIDIA-green gradient border while the model provider is Switchyard. */
	nvidiaGreenBorder?: boolean;
	/** Animate the Switchyard green border when it is visible. */
	nvidiaGreenAnimation?: boolean;
	/** Render pi's status spinners in the top bar instead of their own row. */
	embedWorkingStatus?: boolean;
	/** Host compaction progress in the bottom bar while pi compacts. */
	embedCompactionProgress?: boolean;
	/** Length of the cache hit bar in segments (3–10, default 4); the bar is logarithmic at every size. */
	cacheHitBarSegments?: number;
}

/** Resolved per-segment render options; resolveEffectiveSettings always fills them. */
export interface StatusLineSegmentOptions {
	model: { showModel: boolean; showProvider: boolean; showThinking: boolean };
	path: { abbreviate: boolean; maxLength: number; stripWorkPrefix: boolean };
	context: { showBar: boolean; showStats: boolean };
	cacheHit: { cells: number };
	/** Subscriptions rendered by the feeds segment, in display order. */
	feeds: StatusLineFeed[];
}

/** Which segment groups a build() snapshot needs to populate. */
export interface SegmentIncludes {
	git: boolean;
	pr: boolean;
	piStats: boolean;
	tokenRate: boolean;
	/** Whether the cache-hit graph needs a session-usage snapshot. */
	cacheHit: boolean;
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
	rainbowAnimation: boolean;
	nvidiaGreenBorder: boolean;
	nvidiaGreenAnimation: boolean;
	embedWorkingStatus: boolean;
	embedCompactionProgress: boolean;
	includes: SegmentIncludes;
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
	/** Context usage percent, or null when unknown (no model, or a session pi cannot size). */
	contextPercent: number | null;
	contextTokens: number;
	contextWindow: number;
	/** The latest assistant response's cache-read share of its prompt tokens (pi's footer CH), or null when none has reported prompt tokens. */
	cacheHitPercent?: number | null;
	/**
	 * True while contextPercent and contextTokens are pi's estimate of a freshly
	 * compacted context, shown until pi measures the next response.
	 */
	contextEstimated?: boolean;
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
	/**
	 * Pi's embedded status spinner, pre-rendered and pre-colored by the host for
	 * this frame. Absent while no status indicator is active.
	 */
	workingStatus?: string;
	/**
	 * The live compaction progress, while its bar and figures stand in for the
	 * context graph and pi's stats in the bottom-right group.
	 */
	compaction?: CompactionProgressView;
	/** Live tok/s display state, when this frame needs it. */
	tokenRate: TokenRateDisplay | undefined;
	/**
	 * Newest in-run data payload per subscribed customType. A customType is
	 * absent when no extension publishes it, or when it has published nothing
	 * since this run began — a resumed session still carries the previous run's
	 * entries, and those must not be shown as current.
	 */
	feedData: Record<string, unknown> | undefined;
	/**
	 * Lifecycle state per configured feed field. Missing state is treated as
	 * active so previews and manually constructed contexts retain full color.
	 */
	feedDisplayState?: Record<string, FeedDisplayState>;
}

/** One frame of a compaction from CompactionMonitor, from its start through the completion hold. */
export interface CompactionProgressView {
	/** The 20-cell bar, pre-rendered by compaction-bar.ts with fg/attribute-only resets (39/22, never 0). Its fill is the context share not yet summarized, so it drains as `percent` rises. */
	bar: string;
	/** How far the compaction has progressed, 0..100 (a time-based estimate until pi completes). */
	percent: number;
	/** Context tokens being compacted, from pi's compaction preparation. */
	tokensBefore: number;
	/** The model's context window; 0 when unknown. */
	contextWindow: number;
	/** Time since the compaction started, frozen at completion. */
	elapsedMs: number;
}

export type FeedPhase = "active" | "fading" | "hidden";

export interface FeedDisplayState {
	phase: FeedPhase;
	/** Discrete fade step (0..FADE_SHADE_COUNT-1); meaningful while fading. */
	fadeShade: number;
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
