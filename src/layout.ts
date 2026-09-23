/**
 * The bar layout engine, ported from oh-my-pi component.ts #buildStatusLine.
 *
 * Overflow strategy (in order): drop right segments right-to-left, truncate
 * the embedded `working` status with the caller's chosen ellipsis policy,
 * shrink the elastic `path` segment down to ~8 cells, drop left segments
 * end-first while protecting `path`. A response model appended to the model
 * details gives way before any of the left-group steps, and before the right
 * group when the left group could not fit it even alone. Working indicators
 * retain pi's bare cut; message-style indicators use an ellipsis so truncated
 * prose is apparent.
 * The gap between the two groups is filled with the
 * box-horizontal glyph colored like the editor border, so it tracks the
 * thinking-level border color; the callback receives the gap's absolute
 * column and row in the box, so a caller can paint it as part of a
 * continuous border gradient (the rainbow effect).
 *
 * `options.leftFade` (0..1) blends transient left segments toward the bar
 * background while keeping the Pi symbol and model details solid, which the
 * working-indicator transition uses without hiding stable model information.
 * `options.workingReveal` (0..1) slides the `working` status out from behind
 * the segment before it, trailing separator first, pushing the segments after
 * it right. `options.responseModelReveal` slides a response model out the
 * same way from behind the dot that joins it to the configured model details.
 * Overflow is resolved for fully revealed content, so no segment appears or
 * drops mid-slide and the last frame matches the settled bar.
 */
import { sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { renderSegment, responseModelSuffix } from "./segments.js";
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
	options: { leftFade?: number; workingReveal?: number; responseModelReveal?: number; workingEllipsis?: string } = {},
): string {
	const separatorDef = getSeparator(settings.separator);

	const bgAnsi = settings.transparent ? TRANSPARENT_BG_ANSI : theme.getBgAnsi();
	const transparentBg = bgAnsi === TRANSPARENT_BG_ANSI;
	const fgAnsi = theme.getFgAnsi("text");
	const sepAnsi = theme.getFgAnsi("statusLineSep");
	const leftSepText = ` ${sepAnsi}${separatorDef.left}${fgAnsi} `;
	const rightSepText = ` ${sepAnsi}${separatorDef.right}${fgAnsi} `;

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

	let responseSuffix = leftSegIds.includes("model") ? responseModelSuffix(ctx) : undefined;
	const modelDetails = (): string => renderSegment("model", { ...ctx, responseModel: undefined }).content;

	if (width > 0) {
		// A response model is supplementary to the configured model details, so it
		// gives way before any left segment is truncated, shrunk, or dropped. The
		// right group still yields to it, but only when that makes it fit.
		if (responseSuffix && leftWidth + 1 > width) {
			left[leftSegIds.indexOf("model")] = modelDetails();
			responseSuffix = undefined;
			leftWidth = leftGroupWidth(left);
		}
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
				left[workingIdx] = truncateToWidth(left[workingIdx], available, options.workingEllipsis ?? "");
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

	const fade = options.leftFade;
	if (fade !== undefined && fade < 1) {
		for (const [i, id] of leftSegIds.entries()) {
			if (id === "pi" || id === "model") continue;
			// Reset first so plain text is recolored too, not just segments that
			// set their own foreground color.
			left[i] = theme.fadeAnsi(`\x1b[39m${left[i]}`, fade);
		}
	}

	/**
	 * Slide `unit` out of left part `idx` tail first, drawn after `lead` in the
	 * same part or as the whole part. Ahead of another part, the unit carries the
	 * separator to it and is joined onto that part, which then moves right one
	 * cell per revealed cell. A lead's joiner appears with the first cell.
	 */
	const slideOut = (idx: number, unit: string, reveal: number, lead?: { text: string; joiner: string }): void => {
		const pushes = idx < left.length - 1;
		const moving = pushes ? unit + leftSepText : unit;
		const movingWidth = visibleWidth(moving);
		const shown = Math.round(movingWidth * reveal);
		if (shown > 0) {
			const part = (lead ? lead.text + lead.joiner : "") + sliceByColumn(moving, movingWidth - shown, shown);
			if (pushes) {
				left.splice(idx, 2, part + left[idx + 1]);
				leftSegIds.splice(idx + 1, 1);
			} else {
				left[idx] = part;
			}
		} else if (lead) {
			left[idx] = lead.text;
		} else {
			left.splice(idx, 1);
			leftSegIds.splice(idx, 1);
		}
		leftWidth = leftGroupWidth(left);
	};

	// The response model's dot stays put like the chevron a working status
	// slides out from behind. It resolves first, while `model` still names its
	// own part.
	const modelReveal = options.responseModelReveal;
	const modelIdx = leftSegIds.indexOf("model");
	if (responseSuffix && modelReveal !== undefined && modelReveal < 1 && modelIdx >= 0) {
		slideOut(modelIdx, responseSuffix.label, modelReveal, { text: modelDetails(), joiner: responseSuffix.joiner });
	}

	const reveal = options.workingReveal;
	const slideIdx = leftSegIds.indexOf("working");
	if (reveal !== undefined && reveal < 1 && slideIdx >= 0) slideOut(slideIdx, left[slideIdx], reveal);

	const renderGroup = (parts: string[], direction: "left" | "right"): string => {
		if (parts.length === 0) return "";
		const capPrefix = bgAnsi.replace("\x1b[48;", "\x1b[38;");
		const sepText = direction === "left" ? leftSepText : rightSepText;

		let content = bgAnsi + fgAnsi;
		content += ` ${parts.join(sepText)} `;
		content += "\x1b[0m";

		if (capLeft) content = `${capPrefix}${capLeft}\x1b[0m${content}`;
		if (capRight) content = `${content}${capPrefix}${capRight}\x1b[0m`;
		return content;
	};

	const leftGroup = renderGroup(left, "left");
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
