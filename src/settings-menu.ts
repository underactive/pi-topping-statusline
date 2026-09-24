/**
 * The /topping-statusline-settings command: menu sections for the settings
 * model, a live preview that renders the real box bars with the un-applied
 * menu values, and the command registration.
 */
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { makeBoxPainters, renderBoxRow } from "./box.js";
import { COMPACTION_FIT_PROBE } from "./compaction-embed.js";
import type { SegmentContextBuilder } from "./context.js";
import { buildStatusLine } from "./layout.js";
import { showMenu, type MenuSection, type MenuValue, type PreviewResult } from "./menu.js";
import { NvidiaGreenBorder, isSwitchyardProvider } from "./nvidia-green.js";
import { RAINBOW_CYCLE_MS, RAINBOW_FRAME_MS, RainbowBorder } from "./rainbow.js";
import {
	applySettings,
	BORDER_STYLES,
	bottomRightSegments,
	DEFAULT_FEEDS,
	DEFAULT_SEGMENTS,
	FEED_FORMATS,
	resolveEffectiveSettings,
	saveSettings,
	sanitizeFeeds,
	SEPARATORS,
	topLeftSegments,
	type SettingsState,
} from "./settings.js";
import { theme, type BorderStyle, type SymbolPreset } from "./theme.js";
import type {
	FeedFormat,
	SegmentContext,
	SegmentIncludes,
	StatusLineFeed,
	StatusLineSegmentToggles,
	StatusLineSeparatorStyle,
	StatusLineSettings,
} from "./types.js";

const SYMBOL_LABELS: Record<SymbolPreset, string> = { nerd: "nerdfont", unicode: "unicode", ascii: "ascii" };
const SYMBOL_VALUES: readonly string[] = Object.values(SYMBOL_LABELS);
const SYMBOL_FROM_LABEL: Record<string, SymbolPreset> = Object.fromEntries(
	(Object.entries(SYMBOL_LABELS) as [SymbolPreset, string][]).map(([preset, label]) => [label, preset]),
);

const SECTION_TITLES = [
	"Top Left Segment Group",
	"Top Right Segment Group",
	"Bottom Right Segment Group",
	"Bottom Left Segment Group",
] as const;

const SEGMENT_ROWS: readonly {
	id: keyof StatusLineSegmentToggles;
	label: string;
	section: (typeof SECTION_TITLES)[number];
}[] = [
	{ id: "pi", label: "Pi symbol", section: "Top Left Segment Group" },
	{ id: "model", label: "Model", section: "Top Left Segment Group" },
	{ id: "provider", label: "Provider", section: "Top Left Segment Group" },
	{ id: "thinking", label: "Thinking level", section: "Top Left Segment Group" },
	{ id: "path", label: "Path", section: "Top Left Segment Group" },
	{ id: "git", label: "Git", section: "Top Left Segment Group" },
	{ id: "pr", label: "PR", section: "Top Left Segment Group" },
	{ id: "tokenRateTopRight", label: "Token rate", section: "Top Right Segment Group" },
	{ id: "sessionName", label: "Session name", section: "Top Right Segment Group" },
	{ id: "feeds", label: "Feeds", section: "Bottom Right Segment Group" },
	{ id: "tokenRate", label: "Token rate", section: "Bottom Right Segment Group" },
	{ id: "piStats", label: "Pi stats", section: "Bottom Right Segment Group" },
	{ id: "contextBar", label: "Context bar", section: "Bottom Right Segment Group" },
	{ id: "contextStats", label: "Context stats", section: "Bottom Right Segment Group" },
	{ id: "scrollHint", label: "Scroll hint", section: "Bottom Left Segment Group" },
	{ id: "feedsBottomLeft", label: "Feeds", section: "Bottom Left Segment Group" },
	{ id: "tokenRateBottomLeft", label: "Token rate", section: "Bottom Left Segment Group" },
];

// Feed rows carry a stable key (independent of on-screen position) so
// MenuComponent.rebuild's id-keyed value carry-over survives a removal.
const FEED_PREFIX = "feed";
const feedKey = (key: number, part: keyof StatusLineFeed) => `${FEED_PREFIX}.${key}.${part}`;
const ADD_FEED_ID = `${FEED_PREFIX}.add`;
const removeFeedId = (key: number) => `${FEED_PREFIX}.${key}.remove`;
const FEED_ROW_RE = new RegExp(`^${FEED_PREFIX}\\.(\\d+)\\.`);
const REMOVE_FEED_RE = new RegExp(`^${FEED_PREFIX}\\.(\\d+)\\.remove$`);

interface FeedPair {
	key: number;
	feed: StatusLineFeed;
}

const pairsFromFeeds = (feeds: readonly StatusLineFeed[]): FeedPair[] => feeds.map((feed, key) => ({ key, feed }));

function feedSection(pairs: readonly FeedPair[]): MenuSection {
	const items: MenuSection["items"] = [];
	pairs.forEach(({ key, feed }, index) => {
		const n = index + 1;
		items.push(
			{ id: feedKey(key, "customType"), label: `${n}. type`, value: feed.customType, text: true, placeholder: "ext/custom-type" },
			{ id: feedKey(key, "field"), label: `${n}. field`, value: feed.field, text: true, placeholder: "fieldName" },
			{ id: feedKey(key, "prefix"), label: `${n}. prefix`, value: feed.prefix, text: true, placeholder: "(none)" },
			{ id: feedKey(key, "format"), label: `${n}. format`, value: feed.format, cycleValues: FEED_FORMATS },
			{ id: removeFeedId(key), label: `${n}. remove this feed`, value: false, action: true },
		);
	});
	items.push({ id: ADD_FEED_ID, label: "+ add feed", value: false, action: true });
	return { title: "Feeds", items };
}

/** Read the feed rows back out of the menu's flat value map, keyed by their stable id. */
function feedPairsFromValues(values: Record<string, MenuValue>): FeedPair[] {
	const keys = new Set<number>();
	for (const id of Object.keys(values)) {
		const match = FEED_ROW_RE.exec(id);
		if (match) keys.add(Number(match[1]));
	}
	return [...keys]
		.sort((a, b) => a - b)
		.map((key): FeedPair => {
			const rawFormat = String(values[feedKey(key, "format")] ?? "text");
			return {
				key,
				feed: {
					customType: String(values[feedKey(key, "customType")] ?? ""),
					field: String(values[feedKey(key, "field")] ?? ""),
					prefix: String(values[feedKey(key, "prefix")] ?? ""),
					format: FEED_FORMATS.includes(rawFormat as FeedFormat) ? (rawFormat as FeedFormat) : "text",
				},
			};
		})
		.filter(({ feed }) => feed.customType.trim() || feed.field.trim() || feed.prefix.trim());
}

function feedsFromValues(values: Record<string, MenuValue>): StatusLineFeed[] {
	return feedPairsFromValues(values).map(({ feed }) => feed);
}

function buildSections(settings: StatusLineSettings): MenuSection[] {
	const seg = { ...DEFAULT_SEGMENTS, ...settings.segments };
	const global: MenuSection = {
		title: "Global",
		items: [
			{ id: "transparent", label: "Transparent Segments", value: settings.transparent ?? true },
			{
				id: "separator",
				label: "Separator",
				value: settings.separator ?? "powerline-thin",
				cycleValues: SEPARATORS,
			},
			{ id: "symbols", label: "Symbols", value: SYMBOL_LABELS[settings.symbols ?? "nerd"], cycleValues: SYMBOL_VALUES },
			{
				id: "borderStyle",
				label: "Border style",
				value: settings.borderStyle ?? "rounded",
				cycleValues: BORDER_STYLES,
			},
			{
				id: "rainbowBorder",
				label: "Rainbow border on max thinking",
				value: settings.rainbowBorder ?? true,
			},
			{
				id: "rainbowAnimation",
				label: "Animate rainbow border",
				value: settings.rainbowAnimation ?? true,
			},
			{
				id: "nvidiaGreenBorder",
				label: "NVIDIA-green when using Switchyard",
				value: settings.nvidiaGreenBorder ?? true,
			},
			{
				id: "nvidiaGreenAnimation",
				label: "Animate Switchyard green border",
				value: settings.nvidiaGreenAnimation ?? true,
			},
			{
				id: "embedWorkingStatus",
				label: "Embed status spinners",
				value: settings.embedWorkingStatus ?? false,
			},
			{
				id: "embedCompactionProgress",
				label: "Embed compaction progress",
				value: settings.embedCompactionProgress ?? true,
			},
		],
	};
	return [
		global,
		...SECTION_TITLES.map(title => ({
			title,
			items: SEGMENT_ROWS.filter(row => row.section === title).map(row => ({
				id: row.id,
				label: row.label,
				value: seg[row.id],
			})),
		})),
		feedSection(pairsFromFeeds(settings.feeds ? sanitizeFeeds(settings.feeds) : DEFAULT_FEEDS)),
	];
}

function valuesToSettings(values: Record<string, MenuValue>): StatusLineSettings {
	const segments: StatusLineSegmentToggles = {};
	for (const row of SEGMENT_ROWS) segments[row.id] = values[row.id] === true;
	const separator = values.separator as StatusLineSeparatorStyle;
	const borderStyle = values.borderStyle as BorderStyle;
	return {
		transparent: values.transparent === true,
		separator: SEPARATORS.includes(separator) ? separator : "powerline-thin",
		symbols: SYMBOL_FROM_LABEL[values.symbols as string] ?? "nerd",
		borderStyle: BORDER_STYLES.includes(borderStyle) ? borderStyle : "rounded",
		segments,
		feeds: sanitizeFeeds(feedsFromValues(values)),
		rainbowBorder: values.rainbowBorder === true,
		rainbowAnimation: values.rainbowAnimation === true,
		nvidiaGreenBorder: values.nvidiaGreenBorder === true,
		nvidiaGreenAnimation: values.nvidiaGreenAnimation === true,
		embedWorkingStatus: values.embedWorkingStatus === true,
		embedCompactionProgress: values.embedCompactionProgress === true,
	};
}

// Canned stand-ins keep every toggle visible in the preview even when the
// live session lacks the data (no PR, no scrollback, fresh session).
const CANNED_PR = { number: 42, url: "https://github.com/underactive/pi-topping-statusline/pull/42" };
const CANNED_TOKEN_RATE = { rate: 87, phase: "active", fadeShade: 0 } as const;
/** Stand-in payloads so configured feeds still preview without a live publisher. */
const CANNED_FEED_NUMBER = 1.23;
const CANNED_HINT = "↑ 3 more";
const CANNED_STATS = "↑ 12.4K ↓ 3.1K R 148K W 12K 92.3% $0.42";
const CANNED_GIT = { branch: "main", status: { staged: 1, unstaged: 2, untracked: 3 } };
const CANNED_PERCENT = 42;
const CANNED_WINDOW = 200_000;
/** What pi's border indicator looks like mid-stream with pi-topping's loader installed. */
const CANNED_WORKING = "⠙ Mulling ⢾⣿⣿⣿⣿⣿⢾⢾  28 tps · 11s · ↓ 316 tokens";
/** pi 0.86's compaction spinner: the longest status the bar has to carry. */
const CANNED_COMPACTION = "⠙ Context overflow detected, Auto-compacting... (esc to cancel)";

/** Fill any feed the live session has no entry for, so the preview stays legible. */
function cannedFeedData(
	feeds: readonly StatusLineFeed[],
	live: Record<string, unknown> | undefined,
): Record<string, unknown> {
	const data: Record<string, unknown> = { ...live };
	for (const feed of feeds) {
		if (data[feed.customType] !== undefined || !feed.field) continue;
		data[feed.customType] = {
			[feed.field]: feed.format === "text" ? "sample" : CANNED_FEED_NUMBER,
		};
	}
	return data;
}

class StatusLinePreview {
	readonly #builder: SegmentContextBuilder;
	readonly #uiTheme: Theme;

	constructor(builder: SegmentContextBuilder, uiTheme: Theme) {
		this.#builder = builder;
		this.#uiTheme = uiTheme;
	}

	render(
		values: Record<string, MenuValue>,
		elapsedMs: number,
		activeItemId: string | undefined,
		innerWidth: number,
	): PreviewResult {
		const effective = resolveEffectiveSettings(valuesToSettings(values));
		// Preview lines are indented one cell by the menu; mirror renderBoxed's
		// 6-cell chrome budget for the bars themselves.
		const boxWidth = Math.max(24, innerWidth - 1);
		const barWidth = boxWidth - 6;

		// The theme singleton drives glyph lookups everywhere, so swap the
		// symbol preset for this synchronous render only; the live bar behind
		// the overlay keeps the applied preset.
		const applied = theme.setSymbolPreset(effective.symbols);
		try {
			const include: SegmentIncludes = {
				git: true,
				pr: true,
				piStats: true,
				tokenRate: true,
				feeds: effective.segmentOptions.feeds.map(f => f.customType),
			};
			const base = this.#builder.build(barWidth, effective.segmentOptions, include, CANNED_HINT);
			const greenOn = effective.nvidiaGreenBorder && isSwitchyardProvider(base.model?.provider);
			const rainbowOn = !greenOn && effective.rainbowBorder;
			const animationOn = greenOn ? effective.nvidiaGreenAnimation : rainbowOn && effective.rainbowAnimation;
			const phase = animationOn ? (elapsedMs * 360) / RAINBOW_CYCLE_MS : 0;
			const contextWindow = base.contextWindow || CANNED_WINDOW;
			const ctx: SegmentContext = {
				...base,
				// The preview demos the rainbow whenever the toggle is on,
				// regardless of the live session's thinking level.
				thinkingLevel: rainbowOn ? "max" : base.thinkingLevel,
				git: {
					branch: base.git.branch ?? CANNED_GIT.branch,
					status: base.git.status ?? CANNED_GIT.status,
					pr: base.git.pr ?? CANNED_PR,
				},
				contextPercent: base.contextPercent ?? CANNED_PERCENT,
				contextTokens: base.contextPercent == null ? Math.round((contextWindow * CANNED_PERCENT) / 100) : base.contextTokens,
				contextWindow,
				piStats: base.piStats ?? CANNED_STATS,
				tokenRate: base.tokenRate ?? CANNED_TOKEN_RATE,
				feedData: cannedFeedData(effective.segmentOptions.feeds, base.feedData),
			};

			const box = theme.getBox(effective.borderStyle);
			// The preview box is three rows tall: top bar, side verticals, bottom bar.
			const bottomIdx = 2;
			const colorizer = greenOn ? new NvidiaGreenBorder(phase) : new RainbowBorder(phase);
			const painters = makeBoxPainters({
				colorizerOn: greenOn || rainbowOn,
				colorizer,
				box,
				width: boxWidth,
				bottomIdx,
				flat: s => this.#uiTheme.fg("border", s),
			});
			const embedOn = effective.embedWorkingStatus;
			// Focusing the embed row demos the message-style spinners pi 0.86
			// routes through the same slot, including their ellipsis truncation.
			const compactionDemo = activeItemId === "embedWorkingStatus";
			const sample = compactionDemo ? CANNED_COMPACTION : CANNED_WORKING;
			const top = buildStatusLine(
				barWidth,
				embedOn ? { ...ctx, workingStatus: this.#uiTheme.fg("border", sample) } : ctx,
				effective,
				painters.gapColor,
				{
					left: topLeftSegments(effective, embedOn),
					right: effective.rightSegments,
				},
				{ col: 3, row: 0 },
				{ workingEllipsis: compactionDemo ? "…" : "" },
			);
			// Focusing the compaction row demos the bottom bar hosting
			// pi-topping-compact's progress, while the setting is on.
			const progressDemo = activeItemId === "embedCompactionProgress" && effective.embedCompactionProgress;
			const bottom = buildStatusLine(
				barWidth,
				progressDemo ? { ...ctx, compaction: COMPACTION_FIT_PROBE } : ctx,
				effective,
				painters.gapColor,
				{
					left: effective.bottomLeftSegments,
					right: bottomRightSegments(effective, progressDemo),
				},
				{ col: 3, row: bottomIdx },
			);
			return {
				lines: [
					renderBoxRow(painters, top, 0, boxWidth, box.topLeft, box.topRight),
					painters.paint(1, 0, box.vertical) +
						" ".repeat(Math.max(0, boxWidth - 2)) +
						painters.paint(1, boxWidth - 1, box.vertical),
					renderBoxRow(painters, bottom, bottomIdx, boxWidth, box.bottomLeft, box.bottomRight),
				],
				// A static colorizer stays at phase zero and needs no repaint timer.
				nextRefreshInMs: animationOn ? RAINBOW_FRAME_MS : undefined,
			};
		} finally {
			theme.setSymbolPreset(applied);
		}
	}
}

export function registerSettingsCommand(
	pi: ExtensionAPI,
	state: SettingsState,
	builder: SegmentContextBuilder,
	onChange: () => void,
): void {
	pi.registerCommand("topping-statusline-settings", {
		description: "Configure transparent segments, statusline segments, separator, symbols, border style, feeds, rainbow border animation, the Switchyard NVIDIA-green border, the embedded status spinners, and the embedded compaction progress",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/topping-statusline-settings requires TUI mode", "error");
				return;
			}
			const preview = new StatusLinePreview(builder, ctx.ui.theme);
			const result = await showMenu<Record<string, MenuValue>>(ctx, {
				title: "Pi Topping Statusline: Settings",
				sections: buildSections(state.settings),
				hints: ["↑↓ move", "←→ cycle", "␣ toggle", "⏎ apply/edit", "esc cancel"],
				preview: preview.render.bind(preview),
				onAction: (id, values) => {
					const pairs = feedPairsFromValues(values);
					let nextPairs: FeedPair[];
					if (id === ADD_FEED_ID) {
						const key = Math.max(-1, ...pairs.map(p => p.key)) + 1;
						nextPairs = [...pairs, { key, feed: { customType: "", field: "", prefix: "", format: "currency" } }];
					} else {
						const match = REMOVE_FEED_RE.exec(id);
						if (!match) return undefined;
						const removedKey = Number(match[1]);
						nextPairs = pairs.filter(p => p.key !== removedKey);
					}
					// The whole menu is regenerated so positional labels stay correct
					// after an insert or removal; row ids are untouched by this.
					return [...buildSections(valuesToSettings(values)).slice(0, -1), feedSection(nextPairs)];
				},
			});
			if (!result.applied) return;
			const next = valuesToSettings(result.values);
			applySettings(state, next);
			onChange();
			try {
				saveSettings(next);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`Failed to save statusline settings: ${message}`, "error");
			}
		},
	});
}
