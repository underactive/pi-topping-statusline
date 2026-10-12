import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SegmentContextBuilder, parseGitStatusCounts } from "../context.ts";
import { stripAnsi } from "../footer.ts";
import { SEGMENTS } from "../segments.ts";
import { resolveEffectiveSettings } from "../settings.ts";

const OPTIONS = resolveEffectiveSettings({}).segmentOptions;
const GIT_INCLUDE = { git: true, pr: false, piStats: false, tokenRate: false, feeds: [] };
const NO_GIT_INCLUDE = { ...GIT_INCLUDE, git: false };
const CWD = "/repo";

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function fakeCtx(): ExtensionContext {
	return {
		cwd: CWD,
		getContextUsage: () => undefined,
		sessionManager: {
			getSessionName: () => undefined,
		},
	} as unknown as ExtensionContext;
}

test("parseGitStatusCounts separates staged, unstaged, and untracked paths", () => {
	assert.deepEqual(
		parseGitStatusCounts(" M unstaged.ts\nM  staged.ts\nMM both.ts\nR  renamed.ts\n?? new.ts\n"),
		{ staged: 3, unstaged: 2, untracked: 1 },
	);
});

test("the context builder supplies changed-file counts to the git segment", async () => {
	const commands: string[][] = [];
	const pi = {
		exec: async (_cmd: string, args: string[]) => {
			commands.push(args);
			if (args[0] === "rev-parse") return { code: 0, stdout: "/repo/.git\n/repo/.git\n/repo\n" };
			if (args[0] === "branch") return { code: 0, stdout: "main\n" };
			if (args[0] === "status") return { code: 0, stdout: " M unstaged.ts\nM  staged.ts\n?? new.ts\n" };
			return { code: 1, stdout: "" };
		},
		getThinkingLevel: () => "off",
	} as unknown as ExtensionAPI;
	const builder = new SegmentContextBuilder(pi);
	builder.attach(fakeCtx());
	await flush();

	assert.equal(builder.build(80, OPTIONS, NO_GIT_INCLUDE, undefined).git.status, null);
	builder.build(80, OPTIONS, GIT_INCLUDE, undefined);
	await flush();

	const snapshot = builder.build(80, OPTIONS, GIT_INCLUDE, undefined);
	assert.deepEqual(snapshot.git.status, {
		staged: 1,
		unstaged: 1,
		untracked: 1,
	});
	assert.equal(stripAnsi(SEGMENTS.git.render(snapshot).content).includes("main *1 +1 ?1"), true);
	assert.ok(commands.some(args => args.join(" ") === "status --porcelain"));
	builder.dispose();
});
