/**
 * Node loader hook: resolve the source's `./foo.js` specifiers to `./foo.ts`.
 *
 * Node strips TypeScript natively, so the only gap when running these files
 * under `node --test` is that the extension imports with the `.js` extensions
 * TypeScript's Node16 resolution expects, and those files exist only as `.ts`.
 * Rewriting the specifier here keeps the test runner dependency-free.
 */
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL) {
			const candidate = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
			if (existsSync(candidate)) return nextResolve(candidate.href, context);
		}
		return nextResolve(specifier, context);
	},
});
