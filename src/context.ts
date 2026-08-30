/**
 * SegmentContext builder — the pi-side replacement for the state plumbing in
 * oh-my-pi's StatusLineComponent (git HEAD watcher, status/PR caches).
 *
 * All git/gh access shells out via pi.exec, mirroring the bundled
 * border-status-editor example and pi-synthwave-statusline.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SegmentContext, SegmentIncludes, StatusLineSegmentOptions, TokenRateDisplay } from "./types.js";

const GIT_STATUS_TTL_MS = 1_000;
const BRANCH_POLL_TTL_MS = 5_000;
const EXEC_TIMEOUT_MS = 2_000;

/** getEntries() filters and copies the whole session, so rescans are rate-limited. */
const FEED_TTL_MS = 2_000;

/** Prototype-less map — feed keys are publisher-supplied customTypes. */
const emptyFeedData = (): Record<string, unknown> => Object.create(null);

interface GitStatusCounts {
	staged: number;
	unstaged: number;
	untracked: number;
}

interface RepoInfo {
	gitDir: string;
	commonDir: string;
	toplevel: string;
}

function deriveContextUsage(ctx: ExtensionContext | undefined): {
	contextWindow: number;
	tokens: number | undefined;
	percent: number | null;
} {
	const usage = ctx?.getContextUsage();
	const contextWindow = usage?.contextWindow ?? ctx?.model?.contextWindow ?? 0;
	const tokens = usage?.tokens ?? undefined;
	const percent = usage ? usage.percent : contextWindow > 0 && tokens != null ? (tokens / contextWindow) * 100 : null;
	return { contextWindow, tokens, percent };
}

function parseGitStatus(porcelain: string): GitStatusCounts {
	let staged = 0;
	let unstaged = 0;
	let untracked = 0;
	for (const line of porcelain.split("\n")) {
		if (line.length < 2) continue;
		if (line.startsWith("??")) {
			untracked++;
			continue;
		}
		if (line[0] !== " ") staged++;
		if (line[1] !== " ") unstaged++;
	}
	return { staged, unstaged, untracked };
}

export class SegmentContextBuilder {
	#pi: ExtensionAPI;
	#ctx: ExtensionContext | undefined;
	#requestRender: () => void = () => {};
	#piStatsProvider: ((width: number) => string | undefined) | undefined;
	#tokenRateProvider: (() => TokenRateDisplay) | undefined;

	#repo: RepoInfo | null | undefined = undefined;
	#repoCwd: string | undefined;
	#repoResolving = false;

	#branch: string | null = null;
	#branchFetchedAt = 0;
	#branchInFlight = false;
	#headWatcher: fs.FSWatcher | undefined;
	#watcherOk = false;

	#gitStatus: GitStatusCounts | null = null;
	#gitStatusFetchedAt = 0;
	#gitStatusInFlight = false;

	#pr: { number: number; url: string } | null = null;
	#prBranch: string | null | undefined = undefined;
	#prInFlight = false;
	#ghUnavailable = false;

	#worktree: { projectName: string; worktreeName: string } | null = null;

	#feedData: Record<string, unknown> = emptyFeedData();
	#feedsScannedAt = 0;
	#feedsScanned = "";
	#runStartedAt = 0;

	constructor(pi: ExtensionAPI) {
		this.#pi = pi;
	}

	setRequestRender(fn: () => void): void {
		this.#requestRender = fn;
	}

	setPiStatsProvider(provider: (width: number) => string | undefined): void {
		this.#piStatsProvider = provider;
	}

	setTokenRateProvider(provider: () => TokenRateDisplay): void {
		this.#tokenRateProvider = provider;
	}

	attach(ctx: ExtensionContext): void {
		this.#ctx = ctx;
		// A publisher's figure typically covers one process run — pi-prompt-cache
		// restarts its savings at zero on every session start — while a resumed
		// session still carries the previous run's entries. Anything predating this
		// attach belongs to that stale run.
		this.#runStartedAt = Date.now();
		this.#feedData = emptyFeedData();
		this.#feedsScannedAt = 0;
		this.#feedsScanned = "";
		if (this.#repoCwd !== ctx.cwd) {
			this.#resetGitState();
			this.#repoCwd = ctx.cwd;
			void this.#resolveRepo(ctx.cwd);
		}
	}

	dispose(): void {
		this.#headWatcher?.close();
		this.#headWatcher = undefined;
		this.#watcherOk = false;
		this.#ctx = undefined;
	}

	// ── git plumbing ─────────────────────────────────────────────────────────

	#resetGitState(): void {
		this.#headWatcher?.close();
		this.#headWatcher = undefined;
		this.#watcherOk = false;
		this.#repo = undefined;
		this.#branch = null;
		this.#branchFetchedAt = 0;
		this.#gitStatus = null;
		this.#gitStatusFetchedAt = 0;
		this.#pr = null;
		this.#prBranch = undefined;
		this.#worktree = null;
	}

	async #exec(cmd: string, args: string[], cwd: string): Promise<string | undefined> {
		const result = await this.#pi.exec(cmd, args, { cwd, timeout: EXEC_TIMEOUT_MS }).catch(() => undefined);
		if (!result || result.code !== 0) return undefined;
		return result.stdout;
	}

	async #resolveRepo(cwd: string): Promise<void> {
		if (this.#repoResolving) return;
		this.#repoResolving = true;
		try {
			const out = await this.#exec(
				"git",
				["rev-parse", "--absolute-git-dir", "--git-common-dir", "--show-toplevel"],
				cwd,
			);
			if (this.#repoCwd !== cwd) return;
			if (!out) {
				this.#repo = null;
				return;
			}
			const [gitDir, commonDirRaw, toplevel] = out.trim().split("\n");
			if (!gitDir || !toplevel) {
				this.#repo = null;
				return;
			}
			const commonDir = path.resolve(cwd, commonDirRaw || gitDir);
			this.#repo = { gitDir, commonDir, toplevel };

			// Linked worktree: git-dir diverges from the shared common dir.
			if (path.resolve(gitDir) !== commonDir) {
				const base = path.basename(path.dirname(commonDir));
				const projectName = base.endsWith(".git") ? base.slice(0, -4) : base;
				if (projectName) {
					this.#worktree = { projectName, worktreeName: path.basename(toplevel) };
				}
			}

			this.#setupHeadWatcher();
			void this.#refreshBranch();
			this.#requestRender();
		} finally {
			this.#repoResolving = false;
			if (this.#repoCwd && this.#repoCwd !== cwd) {
				void this.#resolveRepo(this.#repoCwd);
			}
		}
	}

	#setupHeadWatcher(): void {
		this.#headWatcher?.close();
		this.#headWatcher = undefined;
		this.#watcherOk = false;
		if (!this.#repo) return;
		const headPath = path.join(this.#repo.gitDir, "HEAD");
		try {
			const watcher = fs.watch(headPath, () => {
				if (this.#headWatcher !== watcher) return;
				this.#branchFetchedAt = 0;
				this.#gitStatusFetchedAt = 0;
				void this.#refreshBranch();
			});
			watcher.on("error", () => {
				if (this.#headWatcher !== watcher) return;
				watcher.close();
				this.#headWatcher = undefined;
				this.#watcherOk = false;
			});
			this.#headWatcher = watcher;
			this.#watcherOk = true;
		} catch {
			this.#watcherOk = false;
		}
	}

	async #refreshBranch(): Promise<void> {
		const cwd = this.#repoCwd;
		if (!cwd || !this.#repo || this.#branchInFlight) return;
		this.#branchInFlight = true;
		try {
			const out = await this.#exec("git", ["branch", "--show-current"], cwd);
			if (this.#repoCwd !== cwd) return;
			this.#branchFetchedAt = Date.now();
			const next = out?.trim() || "detached";
			const changed = next !== this.#branch;
			this.#branch = next;
			if (changed) {
				this.#prBranch = undefined;
				this.#requestRender();
			}
		} finally {
			this.#branchInFlight = false;
		}
	}

	async #refreshGitStatus(): Promise<void> {
		const cwd = this.#repoCwd;
		if (!cwd || !this.#repo || this.#gitStatusInFlight) return;
		this.#gitStatusInFlight = true;
		try {
			const out = await this.#exec("git", ["status", "--porcelain"], cwd);
			if (this.#repoCwd !== cwd) return;
			this.#gitStatusFetchedAt = Date.now();
			const next = out === undefined ? null : parseGitStatus(out);
			const changed =
				next?.staged !== this.#gitStatus?.staged ||
				next?.unstaged !== this.#gitStatus?.unstaged ||
				next?.untracked !== this.#gitStatus?.untracked;
			this.#gitStatus = next;
			if (changed) this.#requestRender();
		} finally {
			this.#gitStatusInFlight = false;
		}
	}

	/**
	 * Newest in-run payload for each subscribed customType, in one backwards
	 * pass. Walks raw append order rather than the branch-filtered view: a
	 * publisher's own tally does not rewind when /tree moves the leaf, so an
	 * entry stranded on an abandoned branch still reflects what it published.
	 */
	#refreshFeeds(customTypes: readonly string[], now: number): void {
		this.#feedsScannedAt = now;
		this.#feedData = emptyFeedData();
		const entries = this.#ctx?.sessionManager?.getEntries();
		if (!entries) return;
		const pending = new Set(customTypes);
		for (let i = entries.length - 1; i >= 0 && pending.size > 0; i--) {
			const entry = entries[i];
			// custom_message entries carry a customType too, so the kind is checked
			// first: matching on customType alone lets one shadow a real entry.
			if (entry?.type !== "custom" || !pending.has(entry.customType)) continue;
			const ts = Date.parse(entry.timestamp);
			if (!Number.isFinite(ts)) continue;
			if (ts < this.#runStartedAt) break;
			pending.delete(entry.customType);
			if (entry.data !== undefined) this.#feedData[entry.customType] = entry.data;
		}
	}

	async #refreshPr(): Promise<void> {
		const cwd = this.#repoCwd;
		const branch = this.#branch;
		if (!cwd || !this.#repo || !branch || branch === "detached") return;
		if (this.#ghUnavailable || this.#prInFlight || this.#prBranch === branch) return;
		this.#prInFlight = true;
		try {
			const result = await this.#pi
				.exec("gh", ["pr", "view", "--json", "number,url"], { cwd, timeout: 5_000 })
				.catch((error: unknown) => {
					if ((error as NodeJS.ErrnoException)?.code === "ENOENT") this.#ghUnavailable = true;
					return undefined;
				});
			if (this.#repoCwd !== cwd) return;
			this.#prBranch = branch;
			let pr: { number: number; url: string } | null = null;
			if (result && result.code === 0) {
				try {
					const parsed = JSON.parse(result.stdout) as { number?: number; url?: string };
					if (typeof parsed.number === "number" && typeof parsed.url === "string") {
						const u = URL.parse(parsed.url);
						if (
							u &&
							u.protocol === "https:" &&
							u.hostname === "github.com" &&
							!/[\u0000-\u001f\u007f]/.test(parsed.url)
						) {
							pr = { number: parsed.number, url: u.href };
						}
					}
				} catch {
					// non-JSON output — treat as no PR
				}
			}
			const changed = pr?.number !== this.#pr?.number;
			this.#pr = pr;
			if (changed) this.#requestRender();
		} finally {
			this.#prInFlight = false;
		}
	}

	// ── snapshot ─────────────────────────────────────────────────────────────

	build(
		width: number,
		options: StatusLineSegmentOptions,
		include: SegmentIncludes,
		scrollHint: string | undefined,
	): SegmentContext {
		const ctx = this.#ctx;
		const now = Date.now();

		if (include.git || include.pr) {
			const branchStale = now - this.#branchFetchedAt > BRANCH_POLL_TTL_MS;
			if (this.#repo && (branchStale && !this.#watcherOk)) void this.#refreshBranch();
			if (include.git && this.#repo && now - this.#gitStatusFetchedAt > GIT_STATUS_TTL_MS) {
				void this.#refreshGitStatus();
			}
			if (include.pr) void this.#refreshPr();
		}

		if (include.feeds.length > 0) {
			// Editing the subscription list mid-session must not wait out the TTL.
			const key = include.feeds.join("\u0000");
			if (key !== this.#feedsScanned || now - this.#feedsScannedAt > FEED_TTL_MS) {
				this.#feedsScanned = key;
				this.#refreshFeeds(include.feeds, now);
			}
		}

		const model = ctx?.model
			? {
					name: ctx.model.name,
					id: ctx.model.id,
					provider: ctx.model.provider,
					reasoning: ctx.model.reasoning === true,
				}
			: undefined;

		const { contextWindow, tokens, percent: contextPercent } = deriveContextUsage(ctx);

		return {
			options,
			model,
			thinkingLevel: this.#pi.getThinkingLevel(),
			cwd: ctx?.cwd ?? process.cwd(),
			sessionName: ctx?.sessionManager?.getSessionName(),
			contextPercent,
			contextTokens: tokens ?? 0,
			contextWindow,
			git: {
				branch: include.git || include.pr ? this.#branch : null,
				status: include.git ? this.#gitStatus : null,
				pr: include.pr ? this.#pr : null,
			},
			worktree: this.#worktree,
			scrollHint,
			piStats: include.piStats ? this.#piStatsProvider?.(width) : undefined,
			tokenRate: include.tokenRate ? this.#tokenRateProvider?.() : undefined,
			feedData: include.feeds.length > 0 ? { ...this.#feedData } : undefined,
		};
	}
}
