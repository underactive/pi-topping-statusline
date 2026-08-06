import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { MenuComponent } from "../menu.ts";
import type { MenuSection } from "../menu.ts";

const theme = { fg: (_c: string, s: string) => s, bold: (s: string) => s } as unknown as Theme;
const plain = (lines: string[]) => lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, ""));

function makeSections(feeds: { customType: string; prefix: string }[]): MenuSection[] {
	const items: any[] = [];
	feeds.forEach((f, i) => {
		items.push({ id: `feed.${i}.customType`, label: `${i + 1}. type`, value: f.customType, text: true, placeholder: "ext/type" });
		items.push({ id: `feed.${i}.prefix`, label: `${i + 1}. prefix`, value: f.prefix, text: true, placeholder: "(none)" });
		items.push({ id: `feed.${i}.remove`, label: `${i + 1}. remove`, value: false, action: true });
	});
	items.push({ id: "feed.add", label: "+ add feed", value: false, action: true });
	return [{ title: "Feeds", items }];
}

function drive() {
	let result: any;
	const feeds = [{ customType: "pi-prompt-cache/savings", prefix: "CS" }];
	const menu = new MenuComponent(
		{
			title: "T",
			sections: makeSections(feeds),
			onAction: (id, values) => {
				const list: { customType: string; prefix: string }[] = [];
				for (let i = 0; values[`feed.${i}.customType`] !== undefined; i++) {
					list.push({ customType: String(values[`feed.${i}.customType`]), prefix: String(values[`feed.${i}.prefix`]) });
				}
				if (id === "feed.add") list.push({ customType: "", prefix: "" });
				else {
					const m = /^feed\.(\d+)\.remove$/.exec(id);
					if (!m) return undefined;
					list.splice(Number(m[1]), 1);
				}
				return makeSections(list);
			},
		},
		theme,
		r => { result = r; },
	);
	return { menu, get result() { return result; } };
}

const type = (menu: any, s: string) => { for (const ch of s) menu.handleInput(ch); };

test("typing into a text row edits only on commit", () => {
	const { menu } = drive();
	menu.handleInput("\r");                    // Enter on row 0 -> begin editing
	type(menu, "-x");
	assert.match(plain(menu.render(60)).join("\n"), /pi-prompt-cache\/savings-x/, "buffer shown live");
	menu.handleInput("\x7f");                  // backspace
	menu.handleInput("\r");                    // commit
	menu.handleInput("\x1b");                  // escape closes the menu (cancel)
	assert.equal((menu as any).values["feed.0.customType"], "pi-prompt-cache/savings-");
});

test("escape during editing discards the buffer, not the menu", () => {
	const { menu, } = drive();
	menu.handleInput("\r");
	type(menu, "ZZZ");
	menu.handleInput("\x1b");                  // cancel the edit
	assert.equal((menu as any).values["feed.0.customType"], "pi-prompt-cache/savings");
	assert.equal((menu as any).editing, undefined);
	assert.equal(drive().result, undefined);
});

test("escape sequences never enter the buffer", () => {
	const { menu } = drive();
	menu.handleInput("\r");
	menu.handleInput("\x1b[A");                // an arrow key, mid-edit
	menu.handleInput("\r");
	assert.equal((menu as any).values["feed.0.customType"], "pi-prompt-cache/savings");
});

test("add feed appends a blank row; remove drops the right one", () => {
	const { menu } = drive();
	const rowsBefore = (menu as any).flat.length;
	// cursor to "+ add feed" (last row)
	for (let i = 0; i < rowsBefore - 1; i++) menu.handleInput("\x1b[B");
	menu.handleInput("\r");
	assert.equal((menu as any).flat.length, rowsBefore + 3, "one feed = 3 rows");
	assert.equal((menu as any).values["feed.1.customType"], "");

	// remove feed 1 -> back to the original row count
	(menu as any).cursor = 5;                  // "2. remove"
	menu.handleInput("\r");
	assert.equal((menu as any).flat.length, rowsBefore);
	assert.equal((menu as any).values["feed.1.customType"], undefined, "removed values do not linger");
	assert.equal((menu as any).values["feed.0.customType"], "pi-prompt-cache/savings", "survivor kept");
});

test("cursor stays in range after a removal at the end", () => {
	const { menu } = drive();
	(menu as any).cursor = 2;                  // "1. remove"
	menu.handleInput("\r");
	assert.ok((menu as any).cursor < (menu as any).flat.length);
	assert.doesNotThrow(() => menu.render(60));
});

test("placeholder shows for empty text rows", () => {
	const { menu } = drive();
	for (let i = 0; i < (menu as any).flat.length - 1; i++) menu.handleInput("\x1b[B");
	menu.handleInput("\r");                    // add feed
	assert.match(plain(menu.render(60)).join("\n"), /ext\/type/, "placeholder visible");
});
