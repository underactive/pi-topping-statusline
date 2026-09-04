/**
 * The bar layout engine, ported from oh-my-pi component.ts #buildStatusLine.
 *
 * Overflow strategy (in order): drop right segments right-to-left, truncate
 * the embedded `working` status (no ellipsis, as pi's own border does), shrink
 * the elastic `path` segment down to ~8 cells, drop left segments end-first
 * while protecting `path`. The gap between the two groups is filled with the
 * box-horizontal glyph colored like the editor border, so it tracks the
 * thinking-level border color; the callback receives the gap's absolute
 * column and row in the box, so a caller can paint it as part of a
 * continuous border gradient (the rainbow effect).
 *
 * `options.leftFade` (0..1) blends every left segment after a leading `pi`
 * symbol toward the bar background, which the working-indicator transition
 * uses to cross-fade the group without moving the symbol or its chevron.
 */
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { renderSegment } from "./segments.js";
import { getSeparator } from "./separators.js";
import { theme } from "./theme.js";
import type { EffectiveStatusLineSettings, SegmentContext, StatusLineSegmentId } from "./types.js";

const TRANSPARENT_BG_ANSI = "\x1b[49m";

const MIN_PATH_WIDTH = 8;
const MAX_SHRINK_PASSES = 8;
const MIN_PATH_MAX_LENGTH = 4;

/** Re-render the path segment narrower to absorb `overflow` cells; undefined when it cannot shrink. */
function shrinkPathSegment(ctx: SegmentContext, currentContent: string, overflow: number): string | undefined {
	const currentPathVW = visibleWidth(currentContent);
	const shrinkable = currentPathVW - MIN_PATH_WIDTH;
	if (shrinkable <= 0) return undefined;

	const shrinkBy = Math.min(shrinkable, overflow);
	const currentMaxLen = ctx.options.path.maxLength;
	let newMaxLen = Math.max(MIN_PATH_MAX_LENGTH, Math.min(currentMaxLen, currentPathVW) - shrinkBy);
	const pathCtx = (maxLen: number): SegmentContext => ({
		...ctx,
		options: { ...ctx.options, path: { ...ctx.options.path, maxLength: maxLen } },
	});
	let reRendered = renderSegment("path", pathCtx(newMaxLen));
	if (!reRendered.visible || !reRendered.content) return undefined;

	// maxLength governs path text, not icon prefix; iterate to compensate
	for (let i = 0; i < MAX_SHRINK_PASSES; i++) {
		const saved = currentPathVW - visibleWidth(reRendered.content);
		if (saved >= shrinkBy) break;
		const nextMaxLen = Math.max(MIN_PATH_MAX_LENGTH, newMaxLen - (shrinkBy - saved));
		if (nextMaxLen >= newMaxLen) break;
		newMaxLen = nextMaxLen;
		const adjusted = renderSegment("path", pathCtx(newMaxLen));
		if (!adjusted.visible || !adjusted.content) break;
		reRendered = adjusted;
	}
	return reRendered.content;
}

export function buildStatusLine(
	width: number,
	ctx: SegmentContext,
	settings: EffectiveStatusLineSettings,
	gapBorderColor: (str: string, startCol: number, row: number) => string,
	segmentGroups: { left: StatusLineSegmentId[]; right: StatusLineSegmentId[] },
	barOrigin: { col: number; row: number } = { col: 0, row: 0 },
	options: { leftFade?: number } = {},
): string {
	const separatorDef = getSeparator(settings.separator);

	const bgAnsi = settings.transparent ? TRANSPARENT_BG_ANSI : theme.getBgAnsi();
	const transparentBg = bgAnsi === TRANSPARENT_BG_ANSI;
	const fgAnsi = theme.getFgAnsi("text");
	const sepAnsi = theme.getFgAnsi("statusLineSep");

	const left: string[] = [];
	const leftSegIds: StatusLineSegmentId[] = [];
	for (const segId of segmentGroups.left) {
		const rendered = renderSegment(segId, ctx);
		if (rendered.visible && rendered.content) {
			left.push(rendered.content);
			leftSegIds.push(segId);
		}
	}

	const right: string[] = [];
	for (const segId of segmentGroups.right) {
		const rendered = renderSegment(segId, ctx);
		if (rendered.visible && rendered.content) {
			right.push(rendered.content);
		}
	}

	const leftSepWidth = visibleWidth(separatorDef.left);
	const rightSepWidth = visibleWidth(separatorDef.right);
	// Transparent mode drops the round caps (they need a bg fill to bridge);
	// opaque groups wear a half-circle on both ends, drawn with the bar bg as
	// fg so each group reads as a pill. Unicode/ascii presets define no
	// half-circle glyphs, so caps vanish there.
	const capLeft = transparentBg ? "" : theme.sep.halfCircleLeft;
	const capRight = transparentBg ? "" : theme.sep.halfCircleRight;
	const capWidth = visibleWidth(capLeft) + visibleWidth(capRight);

	const groupWidth = (parts: string[], sepWidth: number): number => {
		if (parts.length === 0) return 0;
		const partsWidth = parts.reduce((sum, part) => sum + visibleWidth(part), 0);
		const sepTotal = Math.max(0, parts.length - 1) * (sepWidth + 2);
		return partsWidth + sepTotal + 2 + capWidth;
	};

	const leftGroupWidth = (parts: string[]): number => groupWidth(parts, leftSepWidth);
	const rightGroupWidth = (parts: string[]): number => groupWidth(parts, rightSepWidth);
	let leftWidth = leftGroupWidth(left);
	let rightWidth = rightGroupWidth(right);
	const totalWidth = () => leftWidth + rightWidth + (left.length > 0 || right.length > 0 ? 1 : 0);

	if (width > 0) {
		while (totalWidth() > width && right.length > 0) {
			right.pop();
			rightWidth = rightGroupWidth(right);
		}
		// The working status absorbs overflow first so the Pi symbol beside it
		// survives on narrow terminals.
		const workingIdx = leftSegIds.indexOf("working");
		if (workingIdx >= 0 && totalWidth() > width) {
			const available = visibleWidth(left[workingIdx]) - (totalWidth() - width);
			if (available >= 1) {
				left[workingIdx] = truncateToWidth(left[workingIdx], available, "");
			} else {
				left.splice(workingIdx, 1);
				leftSegIds.splice(workingIdx, 1);
			}
			leftWidth = leftGroupWidth(left);
		}
		// Shrink path before dropping left segments — path is the only elastic segment
		const pathIdx = leftSegIds.indexOf("path");
		if (pathIdx >= 0 && totalWidth() > width) {
			const replacement = shrinkPathSegment(ctx, left[pathIdx], totalWidth() - width);
			if (replacement !== undefined) {
				left[pathIdx] = replacement;
				leftWidth = leftGroupWidth(left);
			}
		}
		const leftOverflowDropIndex = (): number => {
			// Preserve the current working directory as long as possible.
			for (let i = leftSegIds.length - 1; i >= 0; i--) {
				if (leftSegIds[i] !== "path") return i;
			}
			return left.length - 1;
		};

		while (totalWidth() > width && left.length > 0) {
			const dropIdx = leftOverflowDropIndex();
			left.splice(dropIdx, 1);
			leftSegIds.splice(dropIdx, 1);
			leftWidth = leftGroupWidth(left);
		}
	}

	const renderGroup = (parts: string[], direction: "left" | "right", fadeFrom = parts.length): string => {
		if (parts.length === 0) return "";
		const sep = direction === "left" ? separatorDef.left : separatorDef.right;
		const capPrefix = bgAnsi.replace("\x1b[48;", "\x1b[38;");
		const sepText = ` ${sepAnsi}${sep}${fgAnsi} `;

		let body: string;
		const fade = options.leftFade;
		if (fade !== undefined && fade < 1 && fadeFrom < parts.length) {
			// The faded tail opens with an explicit default-fg reset so plain text
			// inside it is recolored too, not just segments that set their own color.
			const head = parts.slice(0, fadeFrom).join(sepText);
			const tail = `\x1b[39m${parts.slice(fadeFrom).join(sepText)}`;
			body = head + theme.fadeAnsi((head ? sepText : "") + tail, fade);
		} else {
			body = parts.join(sepText);
		}
		let content = bgAnsi + fgAnsi;
		content += ` ${body} `;
		content += "\x1b[0m";

		if (capLeft) content = `${capPrefix}${capLeft}\x1b[0m${content}`;
		if (capRight) content = `${content}${capPrefix}${capRight}\x1b[0m`;
		return content;
	};

	const leftGroup = renderGroup(left, "left", leftSegIds[0] === "pi" ? 1 : 0);
	const rightGroup = renderGroup(right, "right");
	if (!leftGroup && !rightGroup) return "";

	if (width === 0) {
		return leftGroup + (leftGroup && rightGroup ? " " : "") + rightGroup;
	}

	const gapWidth = Math.max(1, width - leftWidth - rightWidth);
	const gapFill = gapBorderColor(
		theme.getBox(settings.borderStyle).horizontal.repeat(gapWidth),
		barOrigin.col + leftWidth,
		barOrigin.row,
	);
	if (!leftGroup) return gapFill + rightGroup;
	if (!rightGroup) return leftGroup + gapFill;
	return leftGroup + gapFill + rightGroup;
}
