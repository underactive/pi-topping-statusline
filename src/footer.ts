/**
 * Pure helpers for parsing host-rendered rows: the editor's plain ─── border
 * rows (with or without the scroll hint) and the default footer's stats line.
 */
const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(str: string): string {
	return str.replace(ANSI_RE, "");
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
