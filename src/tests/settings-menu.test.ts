/**
 * Host-level smoke for /topping-statusline-settings: the command mounts the
 * shared menu from @underactive/pi-topping-primitives through ctx.ui.custom,
 * applying persists the draft and cancelling leaves everything alone. The menu's
 * own behaviour is covered by the package's menu-*.test.ts suites; only the
 * component's public surface (handleInput, render, snapshot) is used here.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { MenuComponent } from "@underactive/pi-topping-primitives/menu";
import { SegmentContextBuilder } from "../context.ts";
import { stripAnsi } from "../footer.ts";
import { registerSettingsCommand } from "../settings-menu.ts";
import { createSettingsState, DEFAULT_FEEDS, settingsPath } from "../settings.ts";

const KEY = { up: "\x1b[A", down: "\x1b[B", right: "\x1b[C", space: " ", enter: "\r", escape: "\x1b" } as const;

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	getBgAnsi: () => "",
} as unknown as Theme;

type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
type OverlayFactory = (tui: TUI, theme: Theme, keybindings: KeybindingsManager, done: (result: unknown) => void) => Component;

interface Host {
	handler: CommandHandler;
	ctx: ExtensionCommandContext;
	/** The component the command mounted, once it has. */
	mounted: () => MenuComponent;
	overlayOptions: () => unknown;
	notices: string[];
	changes: () => number;
	settings: () => ReturnType<typeof createSettingsState>["settings"];
	dispose: () => void;
}

/** Register the real command against fakes and expose what the command mounts. */
function host(): Host {
	const commands = new Map<string, CommandHandler>();
	const fakePi = {
		registerCommand: (name: string, options: { handler: CommandHandler }) => commands.set(name, options.handler),
		exec: async () => undefined,
		getThinkingLevel: () => "off",
	} as unknown as ExtensionAPI;
	const state = createSettingsState();
	const builder = new SegmentContextBuilder(fakePi);
	let changes = 0;
	registerSettingsCommand(fakePi, state, builder, () => changes++);
	const handler = commands.get("topping-statusline-settings");
	assert.ok(handler, "the command must be registered");

	let mounted: Component | undefined;
	let overlayOptions: unknown;
	const notices: string[] = [];
	const tui = { terminal: { rows: 40, columns: 100 }, requestRender: () => {} } as unknown as TUI;
	const ctx = {
		mode: "tui",
		ui: {
			theme,
			notify: (message: string) => notices.push(message),
			custom: (factory: OverlayFactory, options: unknown) =>
				new Promise(resolve => {
					overlayOptions = options;
					mounted = factory(tui, theme, {} as KeybindingsManager, resolve);
				}),
		},
	} as unknown as ExtensionCommandContext;

	return {
		handler,
		ctx,
		mounted: () => {
			assert.ok(mounted instanceof MenuComponent, "the command must mount the shared MenuComponent");
			return mounted;
		},
		overlayOptions: () => overlayOptions,
		notices,
		changes: () => changes,
		settings: () => state.settings,
		dispose: () => builder.dispose(),
	};
}

function withTempAgentDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
	const dir = mkdtempSync(join(tmpdir(), "statusline-menu-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	return run(dir).finally(() => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	});
}

const plain = (menu: MenuComponent, width = 80) => menu.render(width).map(stripAnsi);
const typeText = (menu: MenuComponent, text: string) => {
	for (const ch of text) menu.handleInput(ch);
};

test("the settings command mounts the shared menu; adding a feed and applying saves it", () =>
	withTempAgentDir(async () => {
		const h = host();
		try {
			const run = h.handler("", h.ctx);
			const menu = h.mounted();
			assert.deepEqual(h.overlayOptions(), { overlay: true, overlayOptions: { width: "90%", maxHeight: "85%" } });

			const frame = plain(menu);
			assert.match(frame[0] ?? "", /Pi Topping Statusline: Settings/);
			assert.ok(frame.some(line => line.includes("─ Preview ")), "the live preview section is present");
			assert.ok(frame.some(line => /❯ \[■\] Transparent Segments\s+ON/.test(line)), "the selected row carries the ❯ marker");
			assert.ok(!frame.some(line => /^║\s+> /.test(line)), "the old > marker is gone");
			assert.ok(frame.some(line => line.includes("⏎ apply/edit")), "the command's own hints are shown");

			// Up/down stop at the ends, so overshooting lands on the last row: "+ add feed".
			const rows = menu.snapshot().rowCount;
			for (let i = 0; i < rows; i++) menu.handleInput(KEY.down);
			assert.equal(menu.snapshot().cursorId, "feed.add");
			menu.handleInput(KEY.enter);
			assert.equal(menu.snapshot().rowCount, rows + 5, "one feed is five rows");
			assert.equal(menu.snapshot().cursorId, "feed.add", "the cursor keeps its row across the rebuild");

			for (let i = 0; i < 5; i++) menu.handleInput(KEY.up);
			assert.equal(menu.snapshot().cursorId, "feed.0.customType");
			menu.handleInput(KEY.enter);
			typeText(menu, "my-ext/tokens");
			menu.handleInput(KEY.enter);
			menu.handleInput(KEY.down);
			assert.equal(menu.snapshot().cursorId, "feed.0.field");
			menu.handleInput(KEY.enter);
			typeText(menu, "count");
			menu.handleInput(KEY.enter);
			menu.handleInput(KEY.down);
			menu.handleInput(KEY.down);
			assert.equal(menu.snapshot().cursorId, "feed.0.format");
			menu.handleInput(KEY.right); // currency -> number
			assert.ok(plain(menu).some(line => line.includes("my-ext/tokens")), "the committed text shows in the row");

			// Enter on a cycle row applies the whole menu (the menu has no buttons).
			menu.handleInput(KEY.enter);
			await run;

			const added = { customType: "my-ext/tokens", field: "count", prefix: "", format: "number" };
			assert.equal(h.changes(), 1);
			assert.deepEqual(h.settings().feeds, [...DEFAULT_FEEDS, added]);
			assert.deepEqual(JSON.parse(readFileSync(settingsPath(), "utf8")).feeds, [...DEFAULT_FEEDS, added]);
			assert.deepEqual(h.notices, []);
		} finally {
			h.dispose();
		}
	}));

test("escape resolves the command without applying the edited draft", () =>
	withTempAgentDir(async () => {
		const h = host();
		try {
			const run = h.handler("", h.ctx);
			const menu = h.mounted();
			menu.handleInput(KEY.space);
			assert.equal(menu.snapshot().values.transparent, false, "the draft differs from the saved settings");
			menu.handleInput(KEY.escape);
			await run;

			assert.equal(h.changes(), 0);
			assert.deepEqual(h.settings(), {}, "cancelling leaves the loaded settings untouched");
			assert.equal(existsSync(settingsPath()), false, "nothing is written on cancel");
			assert.deepEqual(h.notices, []);
		} finally {
			h.dispose();
		}
	}));
