import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import glob from "fast-glob";
import { toMarkdown } from "mdast-util-to-markdown";
import { parse } from "yaml";

const CUSTOM_TYPE = "context-preload";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.isProjectTrusted()) return;
		if (ctx.sessionManager.getBranch().some((entry) =>
			entry.type === "message" || entry.type === "compaction" || entry.type === "branch_summary" ||
			(entry.type === "custom_message" && entry.customType === CUSTOM_TYPE)
		)) return;

		try {
			let config: string;
			try {
				config = await readFile(join(ctx.cwd, "CONTEXT_PRELOAD.yml"), "utf8");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
				throw error;
			}

			const patterns: unknown = parse(config);
			if (!Array.isArray(patterns) || patterns.some((pattern) => typeof pattern !== "string" || !pattern.trim())) {
				throw new Error("CONTEXT_PRELOAD.yml must contain a list of file globs.");
			}

			const matches = await glob(patterns as string[], { cwd: ctx.cwd, onlyFiles: true, unique: true, absolute: true });
			const files = [...new Set(matches.map((file) => relative(ctx.cwd, file)))];
			files.sort((a, b) => dirname(a).localeCompare(dirname(b)) || a.localeCompare(b));
			if (files.length === 0) return;

			const document: Parameters<typeof toMarkdown>[0] = { type: "root", children: [] };
			for (const file of files) {
				const contents = await readFile(resolve(ctx.cwd, file), "utf8");
				document.children.push(
					{ type: "heading", depth: 2, children: [{ type: "text", value: file }] },
					{ type: "code", value: contents },
				);
			}

			pi.sendMessage({
				customType: CUSTOM_TYPE,
				content: toMarkdown(document, { fences: true }),
				display: true,
			}, { triggerTurn: false });
		} catch (error) {
			const message = `Context preload failed: ${error instanceof Error ? error.message : String(error)}`;
			if (ctx.hasUI) ctx.ui.notify(message, "error");
			else console.error(message);
		}
	});
}
