import assert from "node:assert/strict";
import test from "node:test";
import { hostsWorkingStatus } from "../working-status-embed.ts";

test("only an opted-in editor that receives the host's status hosts the working status", () => {
	const setWorkingStatusIndicator = (): void => {};
	assert.equal(hostsWorkingStatus({ embedWorkingStatus: true, setWorkingStatusIndicator }), true);
	assert.equal(hostsWorkingStatus({ embedWorkingStatus: false, setWorkingStatusIndicator }), false);
	assert.equal(hostsWorkingStatus({ embedWorkingStatus: true }), false, "pre-0.85 hosts never send the status");
	assert.equal(hostsWorkingStatus({}), false);
	assert.equal(hostsWorkingStatus(undefined), false, "a wrapped third-party editor keeps pi's standalone status row");
});
