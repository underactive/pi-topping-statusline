import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadSettings, saveSettings, settingsPath } from "../settings.ts";

function withAgentDir(run: (dir: string) => void): void {
	const dir = mkdtempSync(join(tmpdir(), "statusline-settings-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	try {
		run(dir);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	}
}

test("the settings path follows PI_CODING_AGENT_DIR changes made after import", () => {
	withAgentDir((first) => {
		assert.equal(settingsPath(), join(first, "pi-topping-statusline", "settings.json"));
		withAgentDir((second) => {
			assert.equal(settingsPath(), join(second, "pi-topping-statusline", "settings.json"));
			assert.equal(saveSettings({ transparent: true }).ok, true);
			assert.equal(loadSettings().transparent, true);
		});
	});
});

test("saveSettings writes tab-indented JSON with a trailing newline, mode 0600", () => {
	withAgentDir(() => {
		assert.equal(saveSettings({ transparent: true, separator: "pipe" }).ok, true);
		assert.equal(readFileSync(settingsPath(), "utf8"), '{\n\t"transparent": true,\n\t"separator": "pipe"\n}\n');
		assert.equal(statSync(settingsPath()).mode & 0o777, 0o600);
	});
});

test("saveSettings reports a failure instead of throwing", () => {
	withAgentDir((dir) => {
		writeFileSync(join(dir, "pi-topping-statusline"), "a file where the directory belongs");
		const result = saveSettings({ transparent: true });
		assert.equal(result.ok, false);
	});
});

test("loadSettings ignores a corrupt or non-object file", () => {
	withAgentDir(() => {
		mkdirSync(join(settingsPath(), ".."), { recursive: true });
		writeFileSync(settingsPath(), "[1,2]");
		assert.deepEqual(loadSettings(), {});
		writeFileSync(settingsPath(), "{nope");
		assert.deepEqual(loadSettings(), {});
	});
});
