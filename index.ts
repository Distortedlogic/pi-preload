import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { buffer } from "node:stream/consumers";
import { formatSize, keyHint, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CancellableLoader } from "@earendil-works/pi-tui";
import { globbyStream } from "globby";
import { longestStreak } from "longest-streak";
import pMap from "p-map";
import pTimeout from "p-timeout";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { parse } from "yaml";

const CUSTOM_TYPE = "context-preload";
const PROGRESS_KEY = "context-preload-progress";
const GLOB_LIST = Type.Array(Type.String({ minLength: 1, pattern: "\\S" }));
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const MAX_FILES = 1000;
const CONCURRENCY = 8;
const DEADLINE_MS = 30_000;
async function collectPreload(cwd: string, signal: AbortSignal, report: (message: string) => void) {
	let config: string;
	try {
		const bytes = await readFile(join(cwd, "CONTEXT_PRELOAD.yml"), { signal });
		if (bytes.length > MAX_FILE_BYTES) {
			throw new Error(`CONTEXT_PRELOAD.yml exceeds ${formatSize(MAX_FILE_BYTES)}.`);
		}
		config = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
		throw error;
	}

	const patterns: unknown = parse(config);
	if (!Value.Check(GLOB_LIST, patterns)) {
		throw new Error("CONTEXT_PRELOAD.yml must contain a list of nonempty file globs.");
	}
	if (patterns.length === 0) return;

	for (const pattern of patterns) {
		const path = pattern.startsWith("!") && !pattern.startsWith("!(") ? pattern.slice(1) : pattern;
		if (isAbsolute(path) || path.split(/[\\/]/).includes("..")) {
			throw new Error(`Glob must stay inside cwd: ${pattern}`);
		}
	}

	report("Finding files...");
	const files: string[] = [];
	const stream = globbyStream(patterns, {
		cwd,
		gitignore: true,
		onlyFiles: true,
		followSymbolicLinks: false,
		unique: true,
	});
	const abortDiscovery = () => stream.destroy(
		signal.reason instanceof Error ? signal.reason : new Error("Preload cancelled."),
	);
	signal.addEventListener("abort", abortDiscovery, { once: true });
	try {
		for await (const file of stream) {
			files.push(file);
			if (files.length > MAX_FILES) {
				throw new Error(`Preload has more than ${MAX_FILES} files.`);
			}
		}
	} finally {
		signal.removeEventListener("abort", abortDiscovery);
	}
	signal.throwIfAborted();
	files.sort((a, b) => dirname(a).localeCompare(dirname(b)) || a.localeCompare(b));
	if (files.length === 0) return;

	let checked = 0;
	const selected = await pMap(files, async (file) => {
		signal.throwIfAborted();
		const info = await lstat(join(cwd, file));
		signal.throwIfAborted();
		if (!info.isFile()) throw new Error(`Not a regular file: ${file}`);
		if (info.size > MAX_FILE_BYTES) {
			throw new Error(`${file} is ${formatSize(info.size)}; the file limit is ${formatSize(MAX_FILE_BYTES)}.`);
		}
		report(`Checking sizes: ${++checked}/${files.length}`);
		return { path: file, bytes: info.size };
	}, { concurrency: CONCURRENCY, signal });

	const expectedBytes = selected.reduce((total, file) => total + file.bytes, 0);
	if (expectedBytes > MAX_TOTAL_BYTES) {
		throw new Error(`Selected files total ${formatSize(expectedBytes)}; the limit is ${formatSize(MAX_TOTAL_BYTES)}.`);
	}

	let completed = 0;
	let loadedBytes = 0;
	const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
	const blocks = await pMap(selected, async (file) => {
		const handle = await open(
			join(cwd, file.path),
			constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
		);
		try {
			const info = await handle.stat();
			if (!info.isFile()) throw new Error(`Not a regular file: ${file.path}`);
			if (info.size > MAX_FILE_BYTES) {
				throw new Error(`${file.path} grew beyond ${formatSize(MAX_FILE_BYTES)}.`);
			}
			const bytes = await buffer(handle.createReadStream({
				start: 0,
				end: MAX_FILE_BYTES,
				autoClose: false,
				signal,
			}));
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
			const fence = "`".repeat(Math.max(3, longestStreak(text, "`") + 1));
			report(`Reading files: ${++completed}/${files.length}\n${formatSize(loadedBytes)}/${formatSize(expectedBytes)}`);
			return `## ${file.path}\n\n${fence}\n${text}\n${fence}`;
		} finally {
			await handle.close();
		}
	}, { concurrency: CONCURRENCY, signal });

	signal.throwIfAborted();
	const content = blocks.join("\n\n");
	if (Buffer.byteLength(content) > MAX_TOTAL_BYTES) {
		throw new Error(`Context with headings is over ${formatSize(MAX_TOTAL_BYTES)}.`);
	}
	return { content, count: files.length, bytes: loadedBytes };
}

export default function (pi: ExtensionAPI) {
	let active: AbortController | undefined;

	pi.on("session_shutdown", (_event, ctx) => {
		active?.abort(new Error("Session closed."));
		active = undefined;
		if (ctx.hasUI) ctx.ui.setWidget(PROGRESS_KEY, undefined);
	});

	pi.on("input", (_event, ctx) => {
		if (ctx.hasUI) ctx.ui.setWidget(PROGRESS_KEY, undefined);
		return { action: "continue" };
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.isProjectTrusted() || ctx.sessionManager.buildContextEntries().length > 0) return;

		const controller = new AbortController();
		active = controller;
		const { signal } = controller;

		const insert = async (report: (message: string) => void) => {
			const result = await collectPreload(ctx.cwd, signal, report);
			signal.throwIfAborted();
			if (!result) return;
			if (active !== controller || ctx.sessionManager.buildContextEntries().length > 0) {
				throw new Error("Session changed before preload finished.");
			}


			pi.sendMessage(
				{ customType: CUSTOM_TYPE, content: result.content, display: false },
				{ triggerTurn: false },
			);
			report(`Ready: ${result.count} files — ${formatSize(result.bytes)}`);
			return result;
		};

		const preload = (report: (message: string) => void) => pTimeout(insert(report), {
			milliseconds: DEADLINE_MS,
			signal,
			fallback: () => {
				const error = new Error("Preload timed out after 30 seconds.");
				controller.abort(error);
				throw error;
			},
		});

		const complete = (result: Awaited<ReturnType<typeof insert>>) => {
			if (!ctx.hasUI) return;
			if (!result) {
				ctx.ui.setWidget(PROGRESS_KEY, undefined);
				return;
			}
			const message = `Context preloaded: ${result.count} files — ${formatSize(result.bytes)}`;
			ctx.ui.setWidget(PROGRESS_KEY, [message], { placement: "belowEditor" });
			ctx.ui.notify(message, "info");
		};

		const fail = (error: unknown) => {
			if (active !== controller) return;
			const detail = error instanceof Error ? error.message : String(error);
			const short = `${detail.slice(0, 500)}${detail.length > 500 ? "..." : ""}`;
			const message = `Context preload stopped: ${short} No context was added.`;
			if (ctx.hasUI) {
				ctx.ui.setWidget(PROGRESS_KEY, [message], { placement: "belowEditor" });
				ctx.ui.notify(message, "error");
			} else {
				console.error(message);
			}
		};

		try {
			if (ctx.mode === "tui") {
				ctx.ui.setWidget(PROGRESS_KEY, ["Context preload: reading configuration"], { placement: "belowEditor" });
				await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
					const cancelHint = keyHint("tui.select.cancel", "cancel");
					const loader = new CancellableLoader(
						tui,
						(text) => theme.fg("accent", text),
						(text) => theme.fg("muted", text),
						`Reading CONTEXT_PRELOAD.yml...\n\n${cancelHint}`,
					);
					loader.onAbort = () => controller.abort(new Error("Preload cancelled."));
					void preload((message) => {
						loader.setMessage(`${message}\n\n${cancelHint}`);
						ctx.ui.setWidget(PROGRESS_KEY, [`Context preload: ${message.replace("\n", " — ")}`], {
							placement: "belowEditor",
						});
					}).then(complete, fail).finally(() => done());
					return loader;
				});
			} else {
				complete(await preload((message) => {
					if (ctx.hasUI) ctx.ui.setStatus(CUSTOM_TYPE, message);
				}));
			}
		} catch (error) {
			fail(error);
		} finally {
			if (ctx.hasUI) ctx.ui.setStatus(CUSTOM_TYPE, undefined);
			if (active === controller) active = undefined;
		}
	});
}
