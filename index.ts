import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, join, matchesGlob, relative, resolve } from "node:path";
import { buffer } from "node:stream/consumers";
import { setImmediate } from "node:timers/promises";
import { promisify } from "node:util";
import { estimateTokens, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { parse } from "yaml";

const CUSTOM_TYPE = "context-preload";
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const MAX_FILES = 1000;
const CONCURRENCY = 8;
const DEADLINE_MS = 30_000;
const execFileAsync = promisify(execFile);

async function readText(path: string, limit: number, signal: AbortSignal) {
	signal.throwIfAborted();
	const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
	const file = await open(path, flags);
	try {
		signal.throwIfAborted();
		const stat = await file.stat();
		signal.throwIfAborted();
		if (!stat.isFile()) throw new Error(`Not a regular file: ${path}`);
		if (stat.size > limit) throw new Error(`${path}: ${stat.size} bytes exceeds the ${limit}-byte limit.`);
		const bytes = await buffer(file.createReadStream({ start: 0, end: limit, autoClose: false, signal }));
		signal.throwIfAborted();
		if (bytes.length > limit) throw new Error(`${path} grew beyond the ${limit}-byte limit.`);
		try {
			return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes), bytes: bytes.length };
		} catch {
			throw new Error(`Not valid UTF-8 text: ${path}`);
		}
	} finally {
		await file.close();
	}
}

async function collectPreload(cwd: string, signal: AbortSignal, report: (message: string) => void) {
			let config: string;
			try {
				config = (await readText(join(cwd, "CONTEXT_PRELOAD.yml"), MAX_FILE_BYTES, signal)).text;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
				throw error;
			}

			const patterns: unknown = parse(config);
			if (!Array.isArray(patterns) || patterns.some((pattern) => typeof pattern !== "string" || !pattern.trim())) {
				throw new Error("CONTEXT_PRELOAD.yml must contain a list of file globs.");
			}

			if (patterns.length === 0) return;
			const included: string[] = [];
			const excluded: string[] = [];
			for (const pattern of patterns as string[]) {
				const negative = pattern.startsWith("!") && !pattern.startsWith("!(");
				const raw = negative ? pattern.slice(1) : pattern;
				const local = isAbsolute(raw) ? relative(cwd, raw) : raw;
				if (local === ".." || local.startsWith("../") || local.startsWith("..\\")) {
					throw new Error(`Glob is outside cwd: ${pattern}`);
				}
				(negative ? excluded : included).push(local.startsWith("./") ? local.slice(2) : local);
			}
			if (included.length === 0) return;

			report("Finding non-ignored files...");
			const options = { cwd, signal, encoding: "utf8" as const, maxBuffer: MAX_TOTAL_BYTES };
			const [listed, ignored] = await Promise.all([
				execFileAsync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--deduplicate"], options),
				execFileAsync("git", ["ls-files", "-z", "--cached", "--ignored", "--exclude-standard"], options),
			]);
			signal.throwIfAborted();
			if (listed.stderr.trim() || ignored.stderr.trim()) {
				throw new Error(`Git discovery reported: ${(listed.stderr + ignored.stderr).trim()}`);
			}
			const ignoredFiles = new Set(ignored.stdout.split("\0"));
			const selected = new Set<string>();
			let visited = 0;
			for (const file of listed.stdout.split("\0")) {
				signal.throwIfAborted();
				if (++visited % 128 === 0) {
					report(`Matching globs: ${selected.size} files selected`);
					await setImmediate(undefined, { signal });
				}
				if (!file || ignoredFiles.has(file)) continue;
				if (!included.some((pattern) => matchesGlob(file, pattern))) continue;
				if (excluded.some((pattern) => matchesGlob(file, pattern))) continue;
				selected.add(file);
				if (selected.size > MAX_FILES) throw new Error(`Preload exceeds the ${MAX_FILES}-file limit.`);
			}
			const files = [...selected].sort((a, b) => dirname(a).localeCompare(dirname(b)) || a.localeCompare(b));
			if (files.length === 0) return;

			let totalBytes = 0;
			let checked = 0;
			for (let offset = 0; offset < files.length; offset += CONCURRENCY) {
				await Promise.all(files.slice(offset, offset + CONCURRENCY).map(async (file) => {
					signal.throwIfAborted();
					const stat = await lstat(resolve(cwd, file));
					signal.throwIfAborted();
					if (!stat.isFile()) throw new Error(`Not a regular file: ${file}`);
					if (stat.size > MAX_FILE_BYTES) throw new Error(`${file}: ${stat.size} bytes exceeds the ${MAX_FILE_BYTES}-byte limit.`);
					totalBytes += stat.size;
					if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`Preload exceeds the ${MAX_TOTAL_BYTES}-byte total limit.`);
					report(`Checking sizes: ${++checked}/${files.length} files`);
				}));
			}

			const blocks: string[] = [];
			let loadedBytes = 0;
			let messageBytes = 0;
			let completed = 0;
			for (let offset = 0; offset < files.length; offset += CONCURRENCY) {
				const batch = await Promise.all(files.slice(offset, offset + CONCURRENCY).map(async (file) => {
					const result = await readText(resolve(cwd, file), MAX_FILE_BYTES, signal);
					signal.throwIfAborted();
					loadedBytes += result.bytes;
					if (loadedBytes > MAX_TOTAL_BYTES) throw new Error(`Preload grew beyond the ${MAX_TOTAL_BYTES}-byte total limit.`);
					const fence = "`".repeat((result.text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 2) + 1);
					const block = `## ${file}\n\n${fence}\n${result.text}\n${fence}`;
					messageBytes += Buffer.byteLength(block) + (completed === 0 ? 0 : 2);
					if (messageBytes > MAX_TOTAL_BYTES) throw new Error(`Preload with headings and fences exceeds ${MAX_TOTAL_BYTES} bytes.`);
					report(`Reading files: ${++completed}/${files.length}\n${loadedBytes}/${totalBytes} bytes`);
					return block;
				}));
				blocks.push(...batch);
			}
			signal.throwIfAborted();
			return { content: blocks.join("\n\n"), count: files.length, bytes: loadedBytes };
}

interface PreloadJob {
	controller: AbortController;
	promise: Promise<void>;
	stale: boolean;
	failed: boolean;
	finished: boolean;
	message: string;
	update?: (message: string) => void;
	close?: () => void;
}

function hasHistory(ctx: ExtensionContext) {
	return ctx.sessionManager.getBranch().some((entry) =>
		entry.type === "message" || entry.type === "compaction" || entry.type === "branch_summary" ||
		(entry.type === "custom_message" && entry.customType === CUSTOM_TYPE)
	);
}

export default function (pi: ExtensionAPI) {
	let current: PreloadJob | undefined;

	pi.on("session_start", (_event, ctx) => {
		if (current) {
			current.stale = true;
			current.controller.abort(new Error("Preload replaced."));
			current.close?.();
			current = undefined;
		}
		if (!ctx.isProjectTrusted() || hasHistory(ctx)) return;
		const job: PreloadJob = {
			controller: new AbortController(), promise: Promise.resolve(),
			stale: false, failed: false, finished: false, message: "Reading CONTEXT_PRELOAD.yml...",
		};
		current = job;
		const signal = job.controller.signal;
		const report = (message: string) => {
			if (job.stale || job.finished || current !== job) return;
			job.message = message;
			job.update?.(message);
			if (ctx.mode !== "tui" && ctx.hasUI) ctx.ui.setStatus(CUSTOM_TYPE, message);
		};
		let rejectAbort!: (reason?: unknown) => void;
		const cancelled = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
		const onAbort = () => rejectAbort(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
		const timer = setTimeout(() => job.controller.abort(new Error("Preload timed out after 30 seconds.")), DEADLINE_MS);
		timer.unref();

		if (ctx.mode === "tui") {
			void ctx.ui.custom<void>((tui, _theme, keybindings, done) => {
				const cancelKeys = keybindings.getKeys("tui.select.cancel").join(" / ");
				const panel = Object.assign(new Text("", 1, 1), {
					handleInput(data: string) {
						if (keybindings.matches(data, "tui.select.cancel")) {
							job.controller.abort(new Error("Preload cancelled."));
						}
					},
				});
				job.update = (message) => {
					panel.setText(`Preloading context\n\n${message}\n\nMessage input is locked.\n${cancelKeys}: cancel`);
					tui.requestRender();
				};
				job.close = () => { job.close = undefined; done(); };
				job.update(job.message);
				if (job.finished || job.stale) queueMicrotask(() => job.close?.());
				return panel;
			}).then(() => {
				if (!job.finished && !job.stale) job.controller.abort(new Error("Preload view closed."));
			}).catch((error: unknown) => job.controller.abort(error));
		}

		job.promise = Promise.race([collectPreload(ctx.cwd, signal, report), cancelled]).then((result) => {
			signal.throwIfAborted();
			if (job.stale || current !== job || !result) return;
			if (hasHistory(ctx)) throw new Error("Conversation changed before preload finished.");
			const window = ctx.model?.contextWindow;
			if (window) {
				const available = Math.max(0, Math.floor(window / 2) - (ctx.getContextUsage()?.tokens ?? 0));
				const tokens = estimateTokens({ role: "user", content: [{ type: "text", text: result.content }], timestamp: Date.now() });
				if (tokens > available) throw new Error(`Preload estimate is ${tokens} tokens; its available budget is ${available}.`);
			}
			pi.sendMessage({ customType: CUSTOM_TYPE, content: result.content, display: false }, { triggerTurn: false });
			report(`Ready: ${result.count} files, ${result.bytes} bytes`);
			if (ctx.hasUI) ctx.ui.notify(`Preloaded ${result.count} files (${result.bytes} bytes).`, "info");
		}).catch((error: unknown) => {
			job.failed = true;
			job.controller.abort(error);
			if (job.stale || current !== job) return;
			const detail = error instanceof Error ? error.message : String(error);
			const message = `Context preload stopped: ${detail.slice(0, 1000)}${detail.length > 1000 ? "..." : ""} No context was added.`;
			if (ctx.hasUI) ctx.ui.notify(message, "error");
			else console.error(message);
		}).finally(() => {
			job.finished = true;
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			if (current !== job) return;
			job.close?.();
			if (!job.stale && ctx.mode !== "tui" && ctx.hasUI) ctx.ui.setStatus(CUSTOM_TYPE, undefined);
			current = undefined;
		});
	});

	pi.on("input", async () => {
		const job = current;
		if (!job) return { action: "continue" };
		await job.promise;
		return { action: job.stale || job.failed ? "handled" : "continue" };
	});

	pi.on("session_shutdown", () => {
		if (!current) return;
		current.stale = true;
		current.controller.abort(new Error("Session closed."));
		current.close?.();
		current = undefined;
	});
}
