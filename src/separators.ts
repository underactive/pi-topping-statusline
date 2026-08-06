/** Ported from oh-my-pi status-line/separators.ts; end caps are transparency-driven in layout.ts. */
import { theme } from "./theme.js";
import type { SeparatorDef, StatusLineSeparatorStyle } from "./types.js";

export function getSeparator(style: StatusLineSeparatorStyle): SeparatorDef {
	switch (style) {
		case "powerline":
			return { left: theme.sep.powerlineLeft, right: theme.sep.powerlineRight };
		case "slash": {
			const slash = theme.sep.slash.trim();
			return { left: slash, right: slash };
		}
		case "pipe": {
			const pipe = theme.sep.pipe.trim();
			return { left: pipe, right: pipe };
		}
		case "ascii":
			return { left: theme.sep.asciiLeft, right: theme.sep.asciiRight };
		case "powerline-thin":
			return { left: theme.sep.powerlineThinLeft, right: theme.sep.powerlineThinRight };
	}
}
