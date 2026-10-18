import type { CustomEditor } from "@earendil-works/pi-coding-agent";

type EmbeddingEditor = Partial<Pick<CustomEditor, "embedWorkingStatus" | "setWorkingStatusIndicator">>;

/** Whether an editor this extension built draws the host's working status in its bar. */
export function hostsWorkingStatus(editor: EmbeddingEditor | undefined): boolean {
	return editor?.embedWorkingStatus === true && typeof editor.setWorkingStatusIndicator === "function";
}
