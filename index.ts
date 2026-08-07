/**
 * pi-topping-statusline — oh-my-pi's statusline as a pi extension.
 *
 * Direct port of oh-my-pi's status-line module (can1357/oh-my-pi,
 * packages/coding-agent/src/modes/components/status-line/, MIT). OMP mounts
 * the bar via its editor's setTopBorderProvider. Upstream pi's editor draws
 * plain ─── rows with no corners or sides, so the wrapper re-renders the inner
 * editor 6 columns narrower and rebuilds a full rounded box around its rows:
 * the bar in ╭─ … ─╮, │ sides on every text row, and a dedicated ╰─ … ─╯
 * bottom border carrying configurable left/right segment groups. Upstream's
 * own bottom border row is dropped.
 *
 * ctx.ui.setEditorComponent is a single last-writer-wins slot that other
 * extensions also claim (e.g. rpiv-pi's lane dock installs its own editor on
 * every session_start, and npm packages load after global extensions). Rather
 * than racing for the slot, this extension wraps whichever factory currently
 * owns it — decorating the produced editor's render() output — and re-wraps
 * when the owner changes (checked on an unref'd 1s timer). The host preserves
 * editor text and handlers across setEditorComponent swaps, so re-installing
 * the wrapper mid-session is lossless.
 */
import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { makeBoxPainters, renderBoxRow } from "./src/box.js";
import { SegmentContextBuilder } from "./src/context.js";
import { isBorderRow, stripAnsi, stripRedundantStats } from "./src/footer.js";
import { buildStatusLine } from "./src/layout.js";
import { RAINBOW_DEG_PER_FRAME, RAINBOW_FRAME_MS, RainbowBorder } from "./src/rainbow.js";
import { registerSettingsCommand } from "./src/settings-menu.js";
import { createSettingsState } from "./src/settings.js";
import { theme } from "./src/theme.js";
import { TokenRateMonitor } from "./src/token-rate.js";
type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

export default function (pi: ExtensionAPI) {
	const state = createSettingsState();
	const builder = new SegmentContextBuilder(pi);

	let activeTui: TUI | undefined;
	let activeCtx: ExtensionContext | undefined;
	let ourFactory: EditorFactory | undefined;
	let wrappedFactory: EditorFactory | undefined;
	let ensureTimer: ReturnType<typeof setInterval> | undefined;
	let patchedFooter: Component | undefined;
	let footerRenderOriginal: ((width: number) => string[]) | undefined;

	const requestRender = () => activeTui?.requestRender();
	builder.setRequestRender(requestRender);

	const rateMonitor = new TokenRateMonitor(requestRender);
	rateMonitor.attach(pi);
	builder.setTokenRateProvider(() => rateMonitor.getDisplay());

	// Animated rainbow border while the thinking level is max: a timer steps
	// the hue phase and re-renders; renderBoxed paints the box glyphs from it.
	const rainbow = new RainbowBorder();
	let rainbowTimer: ReturnType<typeof setInterval> | undefined;
	const rainbowActive = (): boolean =>
		state.effective.rainbowBorder && activeCtx !== undefined && pi.getThinkingLevel() === "max";
	const syncRainbow = (): void => {
		if (rainbowActive()) {
			if (!rainbowTimer) {
				rainbowTimer = setInterval(() => {
					if (!rainbowActive()) {
						syncRainbow();
						return;
					}
					rainbow.step(RAINBOW_DEG_PER_FRAME);
					requestRender();
				}, RAINBOW_FRAME_MS);
				rainbowTimer.unref?.();
			}
		} else if (rainbowTimer) {
			clearInterval(rainbowTimer);
			rainbowTimer = undefined;
		}
	};

	registerSettingsCommand(pi, state, builder, () => {
		syncRainbow();
		requestRender();
	});

	const MIN_BOXED_WIDTH = 12;

	const renderBoxed = (
		innerRender: (width: number) => string[],
		width: number,
		editor: { borderColor?: (str: string) => string },
	): string[] => {
		const ctx = activeCtx;
		if (!ctx || width < MIN_BOXED_WIDTH) return innerRender(width);

		// Chrome totals 6 cells on every row, so the bar and the inner text rows
		// share one width budget. Border rows split it 3/3 (╭── … ──╮); text rows
		// split it 2/4 to sit the cursor one column closer to the left edge.
		const innerWidth = width - 6;
		const lines = innerRender(innerWidth);
		// Rows are [top border, ...text rows, bottom border, ...autocomplete rows];
		// autocomplete rows only exist while the dropdown is open, so the bottom
		// border is the last row unless autocompleteState (TS-private on Editor,
		// a plain property at runtime) says otherwise.
		let bottomIdx = lines.length - 1;
		if ((editor as unknown as { autocompleteState?: unknown }).autocompleteState) {
			while (bottomIdx > 0 && !isBorderRow(lines[bottomIdx] ?? "")) bottomIdx--;
		}
		if (lines.length < 3 || bottomIdx < 2) return innerRender(width);

		const hint = stripAnsi(lines[bottomIdx] ?? "").match(/[↑↓] \d+ more/)?.[0] ?? "";
		const effective = state.effective;
		const include = effective.includes;
		const segCtx = builder.build(innerWidth, effective.segmentOptions, include, hint || undefined);
		// borderColor is assigned by the host after the factory returns — read late.
		const border = editor.borderColor ?? ((s: string) => s);
		const rainbowOn = rainbowActive();
		const box = theme.getBox(effective.borderStyle);
		const painters = makeBoxPainters({ rainbowOn, rainbow, box, width, bottomIdx, flat: border });
		const bar = buildStatusLine(
			innerWidth,
			segCtx,
			effective,
			painters.gapColor,
			{
				left: effective.leftSegments,
				right: effective.rightSegments,
			},
			{ col: 3, row: 0 },
		);
		// Leading spacer row: keeps the transcript from sitting flush on the box.
		const out: string[] = ["", renderBoxRow(painters, bar, 0, width, box.topLeft, box.topRight)];
		for (let i = 1; i < bottomIdx; i++) {
			out.push(
				painters.paint(i, 0, box.vertical) + " " + (lines[i] ?? "") + "   " + painters.paint(i, width - 1, box.vertical),
			);
		}
		const bottomBar = buildStatusLine(
			innerWidth,
			segCtx,
			effective,
			painters.gapColor,
			{
				left: effective.bottomLeftSegments,
				right: effective.bottomRightSegments,
			},
			{ col: 3, row: bottomIdx },
		);
		out.push(renderBoxRow(painters, bottomBar, bottomIdx, width, box.bottomLeft, box.bottomRight));
		for (let i = bottomIdx + 1; i < lines.length; i++) {
			out.push(`  ${lines[i]}`);
		}
		return out;
	};

	const wrapFactory = (inner: EditorFactory | undefined): EditorFactory => {
		return (tui, editorTheme, keybindings) => {
			activeTui = tui;
			const editor = inner
				? inner(tui, editorTheme, keybindings)
				: new CustomEditor(tui, editorTheme, keybindings);
			const innerRender = editor.render.bind(editor);
			editor.render = width => renderBoxed(innerRender, width, editor);
			return editor;
		};
	};

	const ensureInstalled = () => {
		const ctx = activeCtx;
		if (!ctx) return;
		const current = ctx.ui.getEditorComponent();
		if (ourFactory && current === ourFactory) return;
		wrappedFactory = current;
		ourFactory = wrapFactory(current);
		ctx.ui.setEditorComponent(ourFactory);
	};

	const PI_STATS_CACHE_MS = 250;
	let piStatsCache: { at: number; value: string | undefined } | undefined;
	builder.setPiStatsProvider(width => {
		if (!footerRenderOriginal) return undefined;
		const now = Date.now();
		if (piStatsCache && now - piStatsCache.at < PI_STATS_CACHE_MS) return piStatsCache.value;
		// Render wide so Pi does not truncate the model side before
		// stripRedundantStats finds its separating padding.
		const line = footerRenderOriginal(Math.max(width, 200))[1];
		const value = stripRedundantStats(line);
		piStatsCache = { at: now, value };
		return value;
	});

	// The default footer is the only component with both setAutoCompactEnabled
	// and setSession. Pi >= 0.84 nests it inside the fullscreen dock's footer
	// Container rather than mounting it directly on the TUI, so search the whole
	// subtree instead of just the top-level children.
	const findFooter = (node: Component): Component | undefined => {
		const probe = node as unknown as Record<string, unknown>;
		if (typeof probe.setAutoCompactEnabled === "function" && typeof probe.setSession === "function") return node;
		if (!Array.isArray(probe.children)) return undefined;
		for (const child of probe.children as Component[]) {
			const found = findFooter(child);
			if (found) return found;
		}
		return undefined;
	};

	// setFooter would replace the whole component (stats + extension-status
	// lines included), so instead patch the live default footer in place and drop
	// its cwd and stats lines, which the box now carries itself.
	const ensureFooterPatched = () => {
		const tui = activeTui;
		if (!tui || patchedFooter) return;
		let footer: Component | undefined;
		for (const child of tui.children) {
			footer = findFooter(child);
			if (footer) break;
		}
		if (!footer) return;
		const orig = footer.render.bind(footer);
		footerRenderOriginal = orig;
		footer.render = width => orig(width).slice(2);
		patchedFooter = footer;
	};

	pi.on("model_select", () => requestRender());
	pi.on("thinking_level_select", () => {
		syncRainbow();
		requestRender();
	});
	pi.on("session_info_changed", () => requestRender());

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI || ctx.mode !== "tui") return;
		activeCtx = ctx;
		builder.attach(ctx);
		rateMonitor.enable();
		syncRainbow();
		ensureInstalled();
		ensureFooterPatched();
		ensureTimer ??= setInterval(() => {
			ensureInstalled();
			ensureFooterPatched();
			// The host's /settings dialog can change the thinking level without
			// firing thinking_level_select, so reconcile the animator periodically.
			syncRainbow();
		}, 1000);
		ensureTimer.unref?.();
	});

	pi.on("session_shutdown", () => {
		rateMonitor.disable();
		builder.dispose();
		if (rainbowTimer) {
			clearInterval(rainbowTimer);
			rainbowTimer = undefined;
		}
		if (ensureTimer) {
			clearInterval(ensureTimer);
			ensureTimer = undefined;
		}
		if (activeCtx && ourFactory && activeCtx.ui.getEditorComponent() === ourFactory) {
			activeCtx.ui.setEditorComponent(wrappedFactory);
		}
		if (patchedFooter && footerRenderOriginal) {
			patchedFooter.render = footerRenderOriginal;
		}
		patchedFooter = undefined;
		footerRenderOriginal = undefined;
		ourFactory = undefined;
		wrappedFactory = undefined;
		activeTui = undefined;
		activeCtx = undefined;
	});
}
