import assert from "node:assert/strict";
import test from "node:test";
import {
	AppearanceTransition,
	STATUS_HOLD_MS,
	STATUS_SLIDE_MS,
	type StatusIndicatorKind,
	StatusTransition,
	WORKING_FADE_MS,
} from "../working-status.ts";

test("appearance transition slides once per absent-to-present change", () => {
	const transition = new AppearanceTransition();
	assert.deepEqual(transition.resolve(false, 900), { pending: false });
	assert.deepEqual(transition.resolve(true, 1_000), { reveal: 0, pending: true });
	const middle = transition.resolve(true, 1_000 + STATUS_SLIDE_MS / 2);
	assert.ok(0 < (middle.reveal ?? -1) && (middle.reveal ?? -1) < 1);
	assert.deepEqual(transition.resolve(true, 1_000 + STATUS_SLIDE_MS), { pending: false });
	assert.deepEqual(transition.resolve(true, 2_000), { pending: false }, "visible content does not restart");

	transition.resolve(false, 2_001);
	assert.deepEqual(transition.resolve(true, 2_002), { reveal: 0, pending: true }, "a later appearance restarts");
});

test("appearance transition reset cancels and rearms the slide", () => {
	const transition = new AppearanceTransition();
	transition.resolve(true, 100);
	transition.reset();
	assert.equal(transition.pending(101), false);
	assert.deepEqual(transition.resolve(true, 102), { reveal: 0, pending: true });
});

/** Show a status early enough that its slide-out has finished by `at`. */
function settle(transition: StatusTransition, status: string, kind: StatusIndicatorKind | undefined, at: number): void {
	transition.resolve(status, kind, at - STATUS_SLIDE_MS);
	transition.resolve(status, kind, at);
}

test("a status appearing over the user's segments slides out, then settles verbatim", () => {
	const transition = new StatusTransition();

	assert.deepEqual(transition.resolve("⠙ Working", "working", 1_000), {
		status: "⠙ Working",
		kind: "working",
		reveal: 0,
		pending: true,
	});
	// Spinner frames change the text mid-slide without restarting it.
	const early = transition.resolve("⠹ Working", "working", 1_000 + STATUS_SLIDE_MS / 4).reveal ?? -1;
	const late = transition.resolve("⠸ Working", "working", 1_000 + (STATUS_SLIDE_MS * 3) / 4).reveal ?? -1;
	assert.ok(0 < early && early < late && late < 1, "reveal grows monotonically");
	assert.equal(transition.pending(1_000 + STATUS_SLIDE_MS - 1), true);

	assert.deepEqual(transition.resolve("⠼ Working", "working", 1_000 + STATUS_SLIDE_MS), {
		status: "⠼ Working",
		kind: "working",
		pending: false,
	});
	assert.equal(transition.pending(1_000 + STATUS_SLIDE_MS), false);
});

test("a status cleared mid-slide keeps sliding through its hold", () => {
	const transition = new StatusTransition();
	transition.resolve("⠙ Working", "working", 0);

	const clearedAt = STATUS_SLIDE_MS / 4;
	const cleared = transition.resolve(undefined, undefined, clearedAt);
	const held = transition.resolve(undefined, undefined, clearedAt + STATUS_HOLD_MS / 2);
	assert.equal(held.status, "⠙ Working");
	assert.ok(0 < (cleared.reveal ?? 1) && (cleared.reveal ?? 1) < (held.reveal ?? 1), "the slide continues");
});

test("clearing a working status holds it, cross-fades both halves, then settles", () => {
	const transition = new StatusTransition();
	settle(transition, "⠙ Working", "working", 1_000);

	const clearedAt = 2_000;
	const holdEndsAt = clearedAt + STATUS_HOLD_MS;
	assert.deepEqual(transition.resolve(undefined, undefined, clearedAt), {
		status: "⠙ Working",
		kind: "working",
		pending: true,
	});
	assert.deepEqual(transition.resolve(undefined, undefined, holdEndsAt - 1), {
		status: "⠙ Working",
		kind: "working",
		pending: true,
	});

	const outgoingStart = transition.resolve(undefined, undefined, holdEndsAt);
	const outgoingMiddle = transition.resolve(undefined, undefined, holdEndsAt + 150);
	const outgoingEnd = transition.resolve(undefined, undefined, holdEndsAt + WORKING_FADE_MS / 2 - 1);
	assert.equal(outgoingStart.status, "⠙ Working");
	assert.equal(outgoingMiddle.status, "⠙ Working");
	assert.equal(outgoingEnd.status, "⠙ Working");
	assert.ok(
		(outgoingStart.leftFade ?? -1) > (outgoingMiddle.leftFade ?? -1) &&
			(outgoingMiddle.leftFade ?? -1) > (outgoingEnd.leftFade ?? -1),
		"outgoing opacity decreases monotonically",
	);

	const incomingStart = transition.resolve(undefined, undefined, holdEndsAt + WORKING_FADE_MS / 2);
	const incomingMiddle = transition.resolve(undefined, undefined, holdEndsAt + 550);
	const incomingEnd = transition.resolve(undefined, undefined, holdEndsAt + WORKING_FADE_MS - 1);
	assert.equal(incomingStart.status, undefined);
	assert.equal(incomingMiddle.status, undefined);
	assert.equal(incomingEnd.status, undefined);
	assert.ok(
		(incomingStart.leftFade ?? 2) < (incomingMiddle.leftFade ?? 2) &&
			(incomingMiddle.leftFade ?? 2) < (incomingEnd.leftFade ?? 2),
		"incoming opacity increases monotonically",
	);
	assert.equal(transition.pending(holdEndsAt + WORKING_FADE_MS - 1), true);

	assert.deepEqual(transition.resolve(undefined, undefined, holdEndsAt + WORKING_FADE_MS), {
		status: undefined,
		kind: undefined,
		pending: false,
	});
	assert.equal(transition.pending(holdEndsAt + WORKING_FADE_MS), false);
});

test("clearing message-style statuses holds them and then cuts without a fade", () => {
	for (const kind of ["compaction", "retry"] as const) {
		const transition = new StatusTransition();
		settle(transition, `⠙ ${kind}`, kind, 100);
		assert.deepEqual(transition.resolve(undefined, undefined, 200), {
			status: `⠙ ${kind}`,
			kind,
			pending: true,
		});
		assert.deepEqual(transition.resolve(undefined, undefined, 200 + STATUS_HOLD_MS - 1), {
			status: `⠙ ${kind}`,
			kind,
			pending: true,
		});
		assert.deepEqual(transition.resolve(undefined, undefined, 200 + STATUS_HOLD_MS), {
			status: undefined,
			kind: undefined,
			pending: false,
		});
	}
});

test("a new status during the hold cuts in immediately and cancels the exit", () => {
	const transition = new StatusTransition();
	settle(transition, "⠙ Working", "working", 1_000);
	transition.resolve(undefined, undefined, 1_100);

	assert.deepEqual(transition.resolve("⠹ Retrying", "retry", 1_200), {
		status: "⠹ Retrying",
		kind: "retry",
		pending: false,
	});
	assert.equal(transition.pending(2_000), false);
});

test("a new status during the fade cuts in immediately and cancels the exit", () => {
	const transition = new StatusTransition();
	settle(transition, "⠙ Working", "working", 0);
	transition.resolve(undefined, undefined, 100);
	const fading = transition.resolve(undefined, undefined, 300);
	assert.equal(fading.status, "⠙ Working");
	assert.equal(fading.pending, true);

	assert.deepEqual(transition.resolve("⠸ Compacting", "compaction", 301), {
		status: "⠸ Compacting",
		kind: "compaction",
		pending: false,
	});
	assert.equal(transition.pending(1_000), false);
});

test("a status arriving after the fade's outgoing half slides out again", () => {
	const transition = new StatusTransition();
	settle(transition, "⠙ Working", "working", 0);
	transition.resolve(undefined, undefined, 100);

	const incomingAt = 100 + STATUS_HOLD_MS + WORKING_FADE_MS / 2;
	assert.equal(transition.resolve(undefined, undefined, incomingAt).status, undefined);
	assert.deepEqual(transition.resolve("⠹ Retrying", "retry", incomingAt + 1), {
		status: "⠹ Retrying",
		kind: "retry",
		reveal: 0,
		pending: true,
	});
});

test("a working-to-compaction handoff across the hold never yields an empty status", () => {
	const transition = new StatusTransition();
	const frames = [
		transition.resolve("⠙ Working", "working", 0),
		transition.resolve(undefined, undefined, 100),
		transition.resolve(undefined, undefined, 100 + STATUS_HOLD_MS - 1),
		transition.resolve("⠸ Compacting", "compaction", 100 + STATUS_HOLD_MS),
	];

	assert.ok(frames.every(frame => frame.status !== undefined));
	assert.equal(frames.at(-1)?.kind, "compaction");
});

test("an undefined kind preserves the pre-0.86 working fade", () => {
	const transition = new StatusTransition();
	transition.resolve("⠙ Working", undefined, 0);
	transition.resolve(undefined, undefined, 10);

	const fadeStarts = transition.resolve(undefined, undefined, 10 + STATUS_HOLD_MS);
	assert.equal(fadeStarts.status, "⠙ Working");
	assert.equal(fadeStarts.leftFade, 1);
	assert.equal(fadeStarts.pending, true);
	assert.deepEqual(transition.resolve(undefined, undefined, 10 + STATUS_HOLD_MS + WORKING_FADE_MS), {
		status: undefined,
		kind: undefined,
		pending: false,
	});
});

test("reset clears live, exiting, and sliding state", () => {
	const transition = new StatusTransition();
	transition.resolve("⠙ Working", "working", 10);
	transition.resolve(undefined, undefined, 20);
	transition.reset();

	assert.deepEqual(transition.resolve(undefined, undefined, 21), {
		status: undefined,
		kind: undefined,
		pending: false,
	});
	assert.equal(transition.pending(21), false);
	assert.equal(transition.resolve("⠹ Working", "working", 22).reveal, 0, "the next status slides from the start");
});
