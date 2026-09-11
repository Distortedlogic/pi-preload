import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { formatSize, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { globby } from "globby";
import pMap from "p-map";
import pTimeout from "p-timeout";
import readYamlFile from "read-yaml-file";
import { Type } from "typebox";
import { Value } from "typebox/value";

const CUSTOM_TYPE = "context-preload";
const GLOB_LIST = Type.Array(Type.String({ minLength: 1, pattern: "\\S" }));
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const MAX_FILES = 1000;
const CONCURRENCY = 8;
const DEADLINE_MS = 30_000;
async function collectPreload(cwd: string, signal: AbortSignal) {
	const [config] = await globby("CONTEXT_PRELOAD.yml", {
		cwd,
		onlyFiles: false,
		followSymbolicLinks: false,
		objectMode: true,
		stats: true,
	});
	signal.throwIfAborted();
	if (!config) return;
	if (!config.dirent.isFile()) throw new Error("CONTEXT_PRELOAD.yml must be a regular file.");
	if (config.stats!.size > MAX_FILE_BYTES) {
		throw new Error(`CONTEXT_PRELOAD.yml exceeds ${formatSize(MAX_FILE_BYTES)}.`);
	}

	const patterns = Value.Decode(GLOB_LIST, await readYamlFile(join(cwd, config.path)));
	signal.throwIfAborted();
	if (patterns.length === 0) return;

	for (const pattern of patterns) {
		const path = pattern.startsWith("!") && !pattern.startsWith("!(") ? pattern.slice(1) : pattern;
		if (isAbsolute(path) || path.split(/[\\/]/).includes("..")) {
			throw new Error(`Glob must stay inside cwd: ${pattern}`);
		}
	}

	const files = await globby(patterns, {
		cwd,
		gitignore: true,
		onlyFiles: true,
		followSymbolicLinks: false,
		unique: true,
		objectMode: true,
		stats: true,
	});
	signal.throwIfAborted();
	if (files.length > MAX_FILES) throw new Error(`Preload has more than ${MAX_FILES} files.`);
	files.sort((a, b) => dirname(a.path).localeCompare(dirname(b.path)) || a.path.localeCompare(b.path));
	if (files.length === 0) return;

	const expectedBytes = files.reduce((total, file) => {
		if (!file.dirent.isFile()) throw new Error(`Not a regular file: ${file.path}`);
		if (file.stats!.size > MAX_FILE_BYTES) {
			throw new Error(
				`${file.path} is ${formatSize(file.stats!.size)}; the file limit is ${formatSize(MAX_FILE_BYTES)}.`,
			);
		}
		return total + file.stats!.size;
	}, 0);
	if (expectedBytes > MAX_TOTAL_BYTES) {
		throw new Error(`Selected files total ${formatSize(expectedBytes)}; the limit is ${formatSize(MAX_TOTAL_BYTES)}.`);
	}

	let loadedBytes = 0;
	const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
	const blocks = await pMap(
		files,
		async (file) => {
			const bytes = await readFile(join(cwd, file.path), { signal });
			if (bytes.length > MAX_FILE_BYTES) {
				throw new Error(`${file.path} grew beyond ${formatSize(MAX_FILE_BYTES)}.`);
			}
			loadedBytes += bytes.length;
			if (loadedBytes > MAX_TOTAL_BYTES) {
				throw new Error(`Selected files grew beyond ${formatSize(MAX_TOTAL_BYTES)}.`);
			}

			let text: string;
			try {
				text = decoder.decode(bytes);
			} catch {
				throw new Error(`${file.path} is not valid UTF-8 text.`);
			}
			return { type: "text" as const, text: `File: ${file.path}\n\n${text}` };
		},
		{ concurrency: CONCURRENCY, signal },
	);

	signal.throwIfAborted();
	const contextBytes = blocks.reduce((total, block) => total + Buffer.byteLength(block.text), 0);
	if (contextBytes > MAX_TOTAL_BYTES) {
		throw new Error(`Context with headings is over ${formatSize(MAX_TOTAL_BYTES)}.`);
	}
	return { blocks, count: files.length, bytes: loadedBytes };
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.isProjectTrusted() || ctx.sessionManager.buildContextEntries().length > 0) return;

		ctx.ui.setStatus(CUSTOM_TYPE, "Preloading context...");

		try {
			const signal = AbortSignal.timeout(DEADLINE_MS);
			const result = await pTimeout(collectPreload(ctx.cwd, signal), {
				milliseconds: DEADLINE_MS,
				signal,
			});
			if (!result) return;

			pi.sendMessage(
				{ customType: CUSTOM_TYPE, content: result.blocks, display: false },
				{ triggerTurn: false },
			);
			ctx.ui.notify(`Context preloaded: ${result.count} files — ${formatSize(result.bytes)}`, "info");
		} finally {
			ctx.ui.setStatus(CUSTOM_TYPE, undefined);
		}
	});
}
