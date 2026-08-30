/**
 * Pure helpers for parsing host-rendered rows: the editor's plain ─── border
 * rows (with or without the scroll hint) and the default footer's stats line.
 */
const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(str: string): string {
	return str.replace(ANSI_RE, "");
}

/** Drop host footer rows that contain only whitespace or SGR control codes. */
export function filterVisibleRows(rows: readonly string[]): string[] {
	return rows.filter(row => stripAnsi(row).trim().length > 0);
}

interface LayoutEntry {
	component: unknown;
	minSize?: number;
}

function containsComponent(node: unknown, target: unknown, seen: Set<unknown>): boolean {
	if (node === target) return true;
	if (!node || typeof node !== "object" || seen.has(node)) return false;
	seen.add(node);
	const children = (node as { children?: unknown }).children;
	return Array.isArray(children) && children.some(child => containsComponent(child, target, seen));
}

/**
 * Let Pi's fullscreen footer slot collapse when its component renders no rows.
 * Pi 0.84 gives that VStack entry minSize=1, independently of render output.
 */
export function collapseFooterLayoutSlot(layoutRoot: unknown, footer: unknown): (() => void) | undefined {
	const seen = new Set<unknown>();
	const find = (node: unknown): LayoutEntry | undefined => {
		if (!node || typeof node !== "object" || seen.has(node)) return undefined;
		seen.add(node);
		const entries = (node as { entries?: unknown }).entries;
		if (!Array.isArray(entries)) return undefined;
		for (const entry of entries as LayoutEntry[]) {
			const nested = find(entry.component);
			if (nested) return nested;
		}
		return (entries as LayoutEntry[]).find(entry => containsComponent(entry.component, footer, new Set()));
	};

	const entry = find(layoutRoot);
	if (!entry) return undefined;
	const previous = entry.minSize;
	entry.minSize = 0;
	return () => {
		if (previous === undefined) delete entry.minSize;
		else entry.minSize = previous;
	};
}

export function isBorderRow(row: string): boolean {
	const text = stripAnsi(row);
	return /^─+$/.test(text) || /^─+ [↑↓] \d+ more\s*─*$/.test(text);
}

// Redundant with the bar or the graph: the footer's first line (cwd + git
// branch + session name) entirely, and — within the stats line — the context
// chunk ("22.8%/1.0M (auto)", which the graph's own label repeats) and the
// right-aligned model side ("(provider) model • thinking"). The unique stats
// (↑↓ tokens, cache R/W, hit rate, cost) survive; when nothing unique remains
// the line collapses entirely.
const CONTEXT_CHUNK_RE = /(?:\?|\d+(?:\.\d+)?%)\/\S+(?: \(auto\))?/;

export function stripRedundantStats(statsLine: string | undefined): string | undefined {
	if (!statsLine) return undefined;
	const plain = stripAnsi(statsLine);
	// The model side is right-aligned with >=2 spaces of padding; stats parts
	// are single-space separated, so the first 2+ space run is the boundary.
	const left = (plain.split(/ {2,}/)[0] ?? "")
		.replace(CONTEXT_CHUNK_RE, "")
		.replace(/\s+/g, " ")
		.trim();
	return left || undefined;
}
