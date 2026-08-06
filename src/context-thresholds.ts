/** Ported verbatim from oh-my-pi status-line/context-thresholds.ts. */
import type { StatusColor } from "./theme.js";
import { formatNumber } from "./utils.js";

export type ContextUsageLevel = "normal" | "warning" | "elevated" | "error";

const CONTEXT_WARNING_PERCENT_THRESHOLD = 50;
const CONTEXT_WARNING_TOKEN_THRESHOLD = 150_000;
const CONTEXT_ELEVATED_PERCENT_THRESHOLD = 70;
const CONTEXT_ELEVATED_TOKEN_THRESHOLD = 270_000;
const CONTEXT_ERROR_PERCENT_THRESHOLD = 90;
const CONTEXT_ERROR_TOKEN_THRESHOLD = 500_000;

function reachesThreshold(
	contextPercent: number,
	contextWindow: number,
	percentThreshold: number,
	tokenThreshold: number,
): boolean {
	if (!Number.isFinite(contextPercent) || contextPercent <= 0) {
		return false;
	}
	if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
		return contextPercent >= percentThreshold;
	}
	const tokenPercentThreshold = (tokenThreshold / contextWindow) * 100;
	return contextPercent >= Math.min(percentThreshold, tokenPercentThreshold);
}

export function getContextUsageLevel(contextPercent: number, contextWindow: number): ContextUsageLevel {
	if (reachesThreshold(contextPercent, contextWindow, CONTEXT_ERROR_PERCENT_THRESHOLD, CONTEXT_ERROR_TOKEN_THRESHOLD)) {
		return "error";
	}
	if (
		reachesThreshold(
			contextPercent,
			contextWindow,
			CONTEXT_ELEVATED_PERCENT_THRESHOLD,
			CONTEXT_ELEVATED_TOKEN_THRESHOLD,
		)
	) {
		return "elevated";
	}
	if (
		reachesThreshold(
			contextPercent,
			contextWindow,
			CONTEXT_WARNING_PERCENT_THRESHOLD,
			CONTEXT_WARNING_TOKEN_THRESHOLD,
		)
	) {
		return "warning";
	}
	return "normal";
}

/**
 * Format context usage as `<pct>%/<window>` when the model window is known.
 * Unknown windows render as `<tokens>/?`.
 */
export function formatContextUsage(
	contextPercent: number | null | undefined,
	contextWindow: number,
	usedTokens?: number,
): string {
	if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
		return `${formatNumber(usedTokens ?? 0)}/?`;
	}
	const pct = contextPercent === null || contextPercent === undefined ? "?" : `${contextPercent.toFixed(1)}%`;
	return `${pct}/${formatNumber(contextWindow)}`;
}

export function getContextUsageThemeColor(level: ContextUsageLevel): StatusColor {
	switch (level) {
		case "error":
			return "error";
		case "elevated":
			return "statusLineContextElevated";
		case "warning":
			return "warning";
		case "normal":
			return "statusLineContext";
	}
}
