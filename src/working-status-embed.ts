import type { CustomEditor } from "@earendil-works/pi-coding-agent";

/**
 * Event-bus channel on which this extension announces, as `{ embedded: boolean }`,
 * whether its bar hosts Pi's working status. pi-topping slides its loader's response
 * model out only while it does. Shared with pi-topping.
 */
export const WORKING_STATUS_EMBED_CHANNEL = "pi-topping-statusline:working-status-embedded";

type EmbeddingEditor = Partial<Pick<CustomEditor, "embedWorkingStatus" | "setWorkingStatusIndicator">>;

/** Whether an editor this extension built draws the host's working status in its bar. */
export function hostsWorkingStatus(editor: EmbeddingEditor | undefined): boolean {
	return editor?.embedWorkingStatus === true && typeof editor.setWorkingStatusIndicator === "function";
}
