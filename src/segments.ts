/**
 * Segment renderers + registry, ported from oh-my-pi status-line/segments.ts.
 *
 * OMP-only decorations inside segments (advisor badge, premium requests,
 * "(sub)", fast-mode icon, jj support) are omitted — pi has no data source
 * for them.
 */
import * as os from "node:os";
import * as path from "node:path";
import { getCapabilities, hyperlink, truncateToWidth } from "@earendil-works/pi-tui";
import { renderContextGraph } from "./context-graph.js";
import { formatContextUsage } from "./context-thresholds.js";
import { MAJOR_COLOR_HEXES, hexToFgAnsi, theme } from "./theme.js";
import {
	clampPathLength,
	getSessionAccentHex,
	sanitizeLabel,
	sanitizeStatusText,
	shortenPath,
	withIcon,
} from "./utils.js";
import type {
	FeedFormat,
	RenderedSegment,
	SegmentContext,
	StatusLineSegment,
	StatusLineSegmentId,
} from "./types.js";

const INVISIBLE: RenderedSegment = { content: "", visible: false };

function relativePathWithinRoot(root: string, target: string): string | null {
	const rel = path.relative(root, target);
	if (rel === "" || rel === ".") return ".";
	if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
	return rel;
}

const DISPLAY_ROOTS: readonly string[] = [path.join(os.homedir(), "Projects"), "/work"];

function stripDisplayRoot(pwd: string): string {
	for (const root of DISPLAY_ROOTS) {
		const relative = relativePathWithinRoot(root, pwd);
		if (relative) return relative;
	}
	return pwd;
}

const SCRATCH_ROOTS: readonly string[] = (() => {
	const roots = new Set<string>([os.tmpdir(), path.join(os.homedir(), "tmp")]);
	if (process.platform === "win32") {
		const { TEMP, TMP, SystemRoot } = process.env;
		if (TEMP) roots.add(TEMP);
		if (TMP) roots.add(TMP);
		if (SystemRoot) roots.add(path.join(SystemRoot, "Temp"));
	} else {
		roots.add("/tmp");
		roots.add("/var/tmp");
		if (process.platform === "darwin") {
			roots.add("/private/tmp");
			roots.add("/private/var/tmp");
		}
	}
	return [...roots];
})();

function classifyProjectDir(pwd: string): { scratch: boolean; relative: string | null } {
	for (const root of SCRATCH_ROOTS) {
		const relative = relativePathWithinRoot(root, pwd);
		if (relative !== null) {
			return { scratch: true, relative: relative === "." ? null : relative };
		}
	}
	return { scratch: false, relative: null };
}

// ═══════════════════════════════════════════════════════════════════════════
// Segment implementations
// ═══════════════════════════════════════════════════════════════════════════

const piSegment: StatusLineSegment = {
	id: "pi",
	render() {
		return { content: theme.fg("accent", theme.icon.pi), visible: true };
	},
};

/** Model · provider · thinking level — related parts joined by the dot, not the group separator. */
const modelSegment: StatusLineSegment = {
	id: "model",
	render(ctx) {
		const { showModel, showProvider, showThinking } = ctx.options.model;
		const parts: string[] = [];

		if (showModel) {
			let modelName = ctx.model?.name || ctx.model?.id || "no-model";
			if (modelName.startsWith("Claude ")) {
				modelName = modelName.slice(7);
			}
			parts.push(withIcon(theme.icon.model, sanitizeStatusText(modelName)));
		}

		if (showProvider && ctx.model?.provider) {
			parts.push(sanitizeStatusText(ctx.model.provider));
		}

		if (showThinking && ctx.model?.reasoning) {
			const level = ctx.thinkingLevel;
			if (level && level !== "off") {
				const display = theme.thinking[level as keyof typeof theme.thinking] ?? "";
				if (display) parts.push(display);
			}
		}

		if (parts.length === 0) return INVISIBLE;
		return { content: theme.fg("statusLineModel", parts.join(theme.sep.dot)), visible: true };
	},
};

const pathSegment: StatusLineSegment = {
	id: "path",
	render(ctx) {
		const opts = ctx.options.path;

		// Linked git worktree: collapse to the project name, appending the
		// worktree dir only when it diverges from the branch (already shown by
		// the git segment).
		if (opts.stripWorkPrefix && ctx.worktree) {
			const { projectName, worktreeName } = ctx.worktree;
			const label = ctx.git.branch === worktreeName ? projectName : `${projectName}/${worktreeName}`;
			const content = withIcon(theme.icon.worktree, clampPathLength(sanitizeStatusText(label), opts.maxLength));
			return { content: theme.fg("statusLinePath", content), visible: true };
		}

		const { scratch, relative } = classifyProjectDir(ctx.cwd);
		let pwd = ctx.cwd;

		if (opts.stripWorkPrefix) {
			if (scratch) {
				if (relative) pwd = relative;
			} else {
				pwd = stripDisplayRoot(pwd);
			}
		}
		if (opts.abbreviate) {
			pwd = shortenPath(pwd);
		}

		pwd = clampPathLength(pwd, opts.maxLength);

		const showScratchIcon = scratch && opts.stripWorkPrefix;
		const icon = showScratchIcon ? theme.icon.scratchFolder : theme.icon.folder;
		const content = withIcon(icon, sanitizeStatusText(pwd));
		return { content: theme.fg("statusLinePath", content), visible: true };
	},
};

const gitSegment: StatusLineSegment = {
	id: "git",
	render(ctx) {
		const { branch, status } = ctx.git;
		if (!branch && !status) return INVISIBLE;

		const isDirty = status && (status.staged > 0 || status.unstaged > 0 || status.untracked > 0);

		let content = "";
		if (branch) {
			content = withIcon(theme.icon.branch, sanitizeStatusText(branch));
		}

		if (status) {
			const indicators: string[] = [];
			if (status.unstaged > 0) indicators.push(theme.fg("statusLineDirty", `*${status.unstaged}`));
			if (status.staged > 0) indicators.push(theme.fg("statusLineStaged", `+${status.staged}`));
			if (status.untracked > 0) indicators.push(theme.fg("statusLineUntracked", `?${status.untracked}`));
			if (indicators.length > 0) {
				const indicatorText = indicators.join(" ");
				content += content ? ` ${indicatorText}` : indicatorText;
			}
		}

		if (!content) return INVISIBLE;

		const colorName = isDirty ? "statusLineGitDirty" : "statusLineGitClean";
		return { content: theme.fg(colorName, content), visible: true };
	},
};

const prSegment: StatusLineSegment = {
	id: "pr",
	render(ctx) {
		const { pr } = ctx.git;
		if (!pr) return INVISIBLE;

		const label = withIcon(theme.icon.pr, `#${pr.number}`);
		const content = getCapabilities().hyperlinks ? hyperlink(label, pr.url) : label;
		return { content: theme.fg("accent", content), visible: true };
	},
};

const piStatsSegment: StatusLineSegment = {
	id: "pi_stats",
	render(ctx) {
		const stats = ctx.piStats;
		if (!stats) return INVISIBLE;
		return { content: theme.fg("dim", sanitizeStatusText(stats)), visible: true };
	},
};

/**
 * Live tok/s badge. Always visible when enabled: active rate in accent, held
 * rate fading accent→dim over FADE_SHADE_COUNT shades, then the `---`
 * placeholder in dim. The value is right-aligned to the placeholder's width so
 * a one- or two-digit rate does not shift whatever sits beside it.
 */
const tokenRateSegment: StatusLineSegment = {
	id: "token_rate",
	render(ctx) {
		const display = ctx.tokenRate;
		if (!display) return INVISIBLE;
		const value = display.rate === null ? "---" : String(display.rate).padStart(3, " ");
		const content = `${value} tok/s`;
		if (display.phase === "active") return { content: theme.fg("accent", content), visible: true };
		if (display.phase === "fading") {
			return { content: theme.fadeFg("accent", "dim", display.fadeShade, content), visible: true };
		}
		return { content: theme.fg("dim", content), visible: true };
	},
};

/**
 * Half a cent is pi-prompt-cache's own display cutoff. Matching it keeps this
 * segment and that extension's footer from ever contradicting each other, and
 * suppresses the negative figures published early in a session while the
 * cache-write premium has yet to be amortized by reads.
 */
const CURRENCY_MIN = 0.005;

/** Rendered text for one feed value, or undefined when it should not show. */
function formatFeedValue(value: unknown, format: FeedFormat): string | undefined {
	if (value == null) return undefined;
	if (format === "text") {
		const text = truncateToWidth(sanitizeStatusText(String(value)), 32);
		return text || undefined;
	}
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	if (format === "currency") {
		if (value < CURRENCY_MIN) return undefined;
		// Savings scale with prefix size and model price: cents on cheap models,
		// but three digits on a heavy session, so the width is not budgeted tight.
		return `$${value < 100 ? value.toFixed(2) : Math.round(value)}`;
	}
	return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/**
 * Values published by other extensions as custom session entries, each shown
 * as its configured prefix followed by the value. A feed contributes nothing
 * when its publisher is absent, has published nothing this run, or reports a
 * value the configured format suppresses.
 */
const feedsSegment: StatusLineSegment = {
	id: "feeds",
	render(ctx) {
		const data = ctx.feedData;
		if (!data) return INVISIBLE;
		const parts: string[] = [];
		for (const feed of ctx.options.feeds) {
			const payload = data[feed.customType];
			if (payload == null || typeof payload !== "object") continue;
			if (!Object.hasOwn(payload, feed.field)) continue;
			const text = formatFeedValue((payload as Record<string, unknown>)[feed.field], feed.format);
			if (text !== undefined) parts.push(`${sanitizeLabel(feed.prefix)}${text}`);
		}
		if (parts.length === 0) return INVISIBLE;
		return { content: theme.fg("success", parts.join(" ")), visible: true };
	},
};

const scrollHintSegment: StatusLineSegment = {
	id: "scroll_hint",
	render(ctx) {
		const hint = ctx.scrollHint;
		if (!hint) return INVISIBLE;
		return { content: theme.fg("dim", hint), visible: true };
	},
};

/** Context bar + stats — related parts joined by a space, not the group separator. */
const contextGraphSegment: StatusLineSegment = {
	id: "context_graph",
	render(ctx) {
		const { showBar, showStats } = ctx.options.context;
		if (!showBar && !showStats) return INVISIBLE;
		const percent = ctx.contextPercent;
		if (percent == null) {
			if (!showStats || ctx.contextTokens <= 0) return INVISIBLE;
			return { content: theme.fg("dim", formatContextUsage(null, ctx.contextWindow, ctx.contextTokens)), visible: true };
		}
		return {
			content: renderContextGraph(percent, ctx.contextWindow, {
				usedTokens: ctx.contextTokens,
				labelColor: theme.getFgAnsi("dim"),
				showBar,
				showStats,
			}),
			visible: true,
		};
	},
};

const accentAnsi = new Map<string, string>();

const sessionNameSegment: StatusLineSegment = {
	id: "session_name",
	render(ctx) {
		const name = ctx.sessionName;
		if (!name) return INVISIBLE;

		let ansi = accentAnsi.get(name);
		if (ansi === undefined) {
			ansi = hexToFgAnsi(getSessionAccentHex(name, MAJOR_COLOR_HEXES));
			accentAnsi.set(name, ansi);
		}
		return { content: `${ansi}${sanitizeStatusText(name)}\x1b[39m`, visible: true };
	},
};

// ═══════════════════════════════════════════════════════════════════════════
// Segment registry
// ═══════════════════════════════════════════════════════════════════════════

export const SEGMENTS: Record<StatusLineSegmentId, StatusLineSegment> = {
	pi: piSegment,
	model: modelSegment,
	path: pathSegment,
	git: gitSegment,
	pr: prSegment,
	session_name: sessionNameSegment,
	pi_stats: piStatsSegment,
	token_rate: tokenRateSegment,
	feeds: feedsSegment,
	context_graph: contextGraphSegment,
	scroll_hint: scrollHintSegment,
};

export function renderSegment(id: StatusLineSegmentId, ctx: SegmentContext): RenderedSegment {
	return SEGMENTS[id].render(ctx);
}
