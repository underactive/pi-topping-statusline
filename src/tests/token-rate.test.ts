/**
 * Display contract for the token_rate segment. The badge is always visible
 * once enabled, so its width has to stay constant: the rate is right-aligned
 * to the width of the `---` placeholder, otherwise dropping from 150 to 9
 * tok/s would shift whatever sits beside it on every frame.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SegmentContextBuilder } from "../context.ts";
import { SEGMENTS } from "../segments.ts";
import { resolveEffectiveSettings } from "../settings.ts";
import { FADE_SHADE_COUNT, theme } from "../theme.ts";
import type { TokenRateDisplay } from "../types.ts";

const fakePi = { exec: async () => undefined, getThinkingLevel: () => "off" } as unknown as ExtensionAPI;
const fakeCtx = {
	cwd: "/tmp/pi-topping-statusline-tests",
	sessionManager: { getEntries: () => [], getSessionName: () => undefined },
	getContextUsage: () => undefined,
	model: undefined,
} as unknown as ExtensionContext;

const builder = new SegmentContextBuilder(fakePi);
builder.attach(fakeCtx);
const BASE = builder.build(
	80,
	resolveEffectiveSettings({}).segmentOptions,
	{ git: false, pr: false, piStats: false, tokenRate: true, feeds: [] },
	undefined,
);

const render = (tokenRate: TokenRateDisplay) => SEGMENTS.token_rate.render({ ...BASE, tokenRate });
const plain = (tokenRate: TokenRateDisplay) => render(tokenRate).content.replace(/\x1b\[[0-9;]*m/g, "");
const active = (rate: number | null): TokenRateDisplay => ({ rate, phase: "active", fadeShade: 0 });

test("the rate is right-aligned to the placeholder's width", () => {
	assert.equal(plain(active(150)), "150 tok/s");
	assert.equal(plain(active(47)), " 47 tok/s");
	assert.equal(plain(active(5)), "  5 tok/s");
	assert.equal(plain(active(null)), "--- tok/s");
});

test("every state renders the same width, so neighbours never shift", () => {
	const widths = new Set(
		[
			plain(active(150)),
			plain(active(47)),
			plain(active(5)),
			plain(active(0)),
			plain(active(null)),
			plain({ rate: 8, phase: "fading", fadeShade: 2 }),
			plain({ rate: null, phase: "idle", fadeShade: 0 }),
		].map(text => text.length),
	);
	assert.equal(widths.size, 1, `expected one width, got ${[...widths].join(", ")}`);
});

test("a four-digit rate grows rather than being truncated", () => {
	assert.equal(plain(active(1200)), "1200 tok/s");
});

test("phase drives the colour: accent live, blended fading, dim idle", () => {
	assert.ok(render(active(150)).content.includes(theme.getFgAnsi("accent")));
	assert.ok(render({ rate: null, phase: "idle", fadeShade: 0 }).content.includes(theme.getFgAnsi("dim")));
	// The fade interpolates, so it emits a colour of its own rather than either endpoint.
	const fading = render({ rate: 150, phase: "fading", fadeShade: FADE_SHADE_COUNT - 1 });
	assert.match(fading.content, /\x1b\[38;[25]/);
	assert.equal(plain({ rate: 150, phase: "fading", fadeShade: 2 }), "150 tok/s");
});

test("the segment hides only when the monitor supplies nothing", () => {
	assert.equal(SEGMENTS.token_rate.render({ ...BASE, tokenRate: undefined }).visible, false);
	assert.equal(render(active(null)).visible, true, "idle still shows the placeholder");
});
