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
import { makeBoxPainters, renderBoxRow, renderBoxRowIfVisible } from "./src/box.js";
import { SegmentContextBuilder } from "./src/context.js";
import {
	collapseFooterLayoutSlot,
	filterVisibleRows,
	isBorderRow,
	stripAnsi,
	stripRedundantStats,
} from "./src/footer.js";
import { buildStatusLine } from "./src/layout.js";
import { RAINBOW_DEG_PER_FRAME, RAINBOW_FRAME_MS, RainbowBorder } from "./src/rainbow.js";
import { registerSettingsCommand } from "./src/settings-menu.js";
import { createSettingsState, topLeftSegments } from "./src/settings.js";
import { easeFade } from "./src/theme.js";
import { theme } from "./src/theme.js";
import { TokenRateMonitor } from "./src/token-rate.js";
type EditorFactory = NonNullable<ReturnType<ExtensionContext["ui"]["getEditorComponent"]>>;

/** Cross-fade budget when the embedded working status disappears: half out, half in. */
const WORKING_FADE_MS = 750;
const WORKING_FADE_FRAME_MS = 15;

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
	let restoreFooterLayout: (() => void) | undefined;
	// The CustomEditor this extension constructed itself (undefined when it wraps
	// another extension's editor), and the host's working indicator captured
	// from that editor while a response streams.
	let activeEditor: CustomEditor | undefined;
	let embeddedWorkingStatus: ((width: number) => string) | undefined;
	// Fade from the working status back to the user's left segments when a
	// stream ends. The last status text is kept so the outgoing half still has
	// something to fade after pi has cleared its indicator.
	let workingShown = false;
	let lastWorkingText: string | undefined;
	let workingFade: { start: number } | undefined;
	let workingFadeTimer: ReturnType<typeof setInterval> | undefined;
	const stopWorkingFadeTimer = (): void => {
		if (workingFadeTimer) clearInterval(workingFadeTimer);
		workingFadeTimer = undefined;
	};

	const syncEmbed = (): void => {
		const ctx = activeCtx;
		const factory = ourFactory;
		if (!activeEditor || !ctx || !factory) return;
		const next = state.effective.embedWorkingStatus;
		if (activeEditor.embedWorkingStatus === next) return;
		ctx.ui.setEditorComponent(factory);
	};

	const requestRender = () => activeTui?.requestRender();
	builder.setRequestRender(requestRender);
	const startWorkingFadeTimer = (): void => {
		if (workingFadeTimer) return;
		workingFadeTimer = setInterval(() => {
			if (!workingFade || Date.now() - workingFade.start >= WORKING_FADE_MS) {
				workingFade = undefined;
				stopWorkingFadeTimer();
			}
			requestRender();
		}, WORKING_FADE_FRAME_MS);
		workingFadeTimer.unref?.();
	};

	/**
	 * Which left group this frame shows and how far it has faded. A stream
	 * starting shows the working status at once. A stream ending starts a
	 * 750ms clock: the status sinks into the bar background for the first
	 * half, then the user's segments rise out of it.
	 */
	const resolveWorkingFrame = (live: string | undefined): { working: string | undefined; leftFade?: number } => {
		const now = Date.now();
		const liveShown = live !== undefined;
		if (liveShown) lastWorkingText = live;
		if (liveShown !== workingShown) {
			workingShown = liveShown;
			if (liveShown) {
				// Instant cut in, and it cancels any fade-out still running.
				workingFade = undefined;
			} else {
				workingFade = { start: now };
				startWorkingFadeTimer();
			}
		}
		if (!workingFade) return { working: live };
		const half = WORKING_FADE_MS / 2;
		const elapsed = now - workingFade.start;
		if (elapsed >= WORKING_FADE_MS) {
			workingFade = undefined;
			return { working: live };
		}
		const outgoing = elapsed < half;
		const leftFade = easeFade(outgoing ? 1 - elapsed / half : (elapsed - half) / half);
		return { working: outgoing ? lastWorkingText : undefined, leftFade };
	};

	const rateMonitor = new TokenRateMonitor(requestRender);
	rateMonitor.attach(pi);
	builder.setTokenRateProvider(() => rateMonitor.getDisplay());

	// The rainbow is visible at max thinking independently of whether its hue
	// phase is animated. Stopping the timer preserves the current live phase.
	const rainbow = new RainbowBorder();
	let rainbowTimer: ReturnType<typeof setInterval> | undefined;
	const rainbowActive = (): boolean =>
		state.effective.rainbowBorder && activeCtx !== undefined && pi.getThinkingLevel() === "max";
	const rainbowAnimationActive = (): boolean => rainbowActive() && state.effective.rainbowAnimation;
	const syncRainbow = (): void => {
		if (rainbowAnimationActive()) {
			if (!rainbowTimer) {
				rainbowTimer = setInterval(() => {
					if (!rainbowAnimationActive()) {
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
		syncEmbed();
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
		// The layout truncates the status to fit, so it is rendered at full width here.
		const live = effective.embedWorkingStatus ? embeddedWorkingStatus?.(innerWidth) || undefined : undefined;
		const { working, leftFade } = resolveWorkingFrame(live);
		const bar = buildStatusLine(
			innerWidth,
			{ ...segCtx, workingStatus: working },
			effective,
			painters.gapColor,
			{
				left: topLeftSegments(effective, working !== undefined),
				right: effective.rightSegments,
			},
			{ col: 3, row: 0 },
			{ leftFade },
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
		out.push(...renderBoxRowIfVisible(painters, bottomBar, bottomIdx, width, box.bottomLeft, box.bottomRight));
		for (let i = bottomIdx + 1; i < lines.length; i++) {
			out.push(`  ${lines[i]}`);
		}
		return out;
	};

	const wrapFactory = (inner: EditorFactory | undefined): EditorFactory => {
		return (tui, editorTheme, keybindings) => {
			activeTui = tui;
			let editor: ReturnType<EditorFactory>;
			if (inner) {
				// A wrapped third-party editor is not opted in: pi keeps its
				// standalone working row for it.
				editor = inner(tui, editorTheme, keybindings);
				activeEditor = undefined;
				embeddedWorkingStatus = undefined;
			} else {
				const own = new CustomEditor(tui, editorTheme, keybindings, {
					embedWorkingStatus: state.effective.embedWorkingStatus,
				});
				// Capture the host's indicator on its way in; renderBoxed draws it
				// into the top bar since the inner top border (lines[0]) is discarded.
				if (typeof own.setWorkingStatusIndicator === "function") {
					const setIndicator = own.setWorkingStatusIndicator.bind(own);
					own.setWorkingStatusIndicator = indicator => {
						embeddedWorkingStatus = indicator ? width => indicator.renderInBorder(width) : undefined;
						setIndicator(indicator);
					};
				}
				activeEditor = own;
				editor = own;
			}
			const innerRender = editor.render.bind(editor);
			let boxRenderFailed = false;
			editor.render = width => {
				try {
					return renderBoxed(innerRender, width, editor);
				} catch (err) {
					if (!boxRenderFailed) {
						boxRenderFailed = true;
						activeCtx?.ui.notify(
							`Statusline render failed, using plain editor: ${err instanceof Error ? err.message : String(err)}`,
							"error",
						);
					}
					return innerRender(width);
				}
			};
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
		if (!tui) return;
		if (!patchedFooter) {
			let footer: Component | undefined;
			for (const child of tui.children) {
				footer = findFooter(child);
				if (footer) break;
			}
			if (!footer) return;
			const orig = footer.render.bind(footer);
			footerRenderOriginal = orig;
			footer.render = width => filterVisibleRows(orig(width).slice(2));
			patchedFooter = footer;
		}
		if (!restoreFooterLayout) {
			const layoutRoot = (tui as unknown as { layoutRoot?: unknown }).layoutRoot;
			restoreFooterLayout = collapseFooterLayoutSlot(layoutRoot, patchedFooter);
		}
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
		syncEmbed();
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
		restoreFooterLayout?.();
		patchedFooter = undefined;
		footerRenderOriginal = undefined;
		restoreFooterLayout = undefined;
		ourFactory = undefined;
		wrappedFactory = undefined;
		activeEditor = undefined;
		embeddedWorkingStatus = undefined;
		stopWorkingFadeTimer();
		workingFade = undefined;
		workingShown = false;
		lastWorkingText = undefined;
		activeTui = undefined;
		activeCtx = undefined;
	});
}
