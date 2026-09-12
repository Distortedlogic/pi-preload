import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ExtensionAPI, formatSize } from "@earendil-works/pi-coding-agent";
import { globby } from "globby";
import pMap from "p-map";
import { readYamlFile } from "read-yaml-file";
import { Type } from "typebox";
import { Value } from "typebox/value";

const CUSTOM_TYPE = "context-preload";
const GLOB_LIST = Type.Array(Type.String({ minLength: 1 }));
const PRELOAD_CONFIG = Type.Object(
	{
		extends: Type.Optional(GLOB_LIST),
		files: Type.Optional(GLOB_LIST),
	},
	{ additionalProperties: false },
);
const LOCK_FILE_GLOBS = [
	"**/.terraform.lock.hcl",
	"**/bun.lock",
	"**/bun.lockb",
	"**/Cargo.lock",
	"**/composer.lock",
	"**/deno.lock",
	"**/flake.lock",
	"**/Gemfile.lock",
	"**/gradle.lockfile",
	"**/mix.lock",
	"**/npm-shrinkwrap.json",
	"**/package-lock.json",
	"**/Package.resolved",
	"**/packages.lock.json",
	"**/paket.lock",
	"**/Pipfile.lock",
	"**/pnpm-lock.yaml",
	"**/Podfile.lock",
	"**/poetry.lock",
	"**/pubspec.lock",
	"**/uv.lock",
	"**/yarn.lock",
];
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const MAX_FILES = 1000;
const CONCURRENCY = 8;
const DEADLINE_MS = 30_000;
const DEFAULT_PRESET_DIRECTORY = fileURLToPath(new URL("./presets/", import.meta.url));

async function loadPatterns(
	configPath: string,
	presetDirectory: string,
	signal: AbortSignal,
	ancestors: string[] = [],
): Promise<string[]> {
	const path = resolve(configPath);
	if (ancestors.includes(path)) throw new Error(`Circular context preload preset: ${path}`);
	const config = Value.Parse(PRELOAD_CONFIG, await readYamlFile(path));
	const ownPatterns = config.files ?? [];
	if (ancestors.length > 0) {
		const relativePattern = ownPatterns.find(
			(pattern) => !isAbsolute(pattern.startsWith("!") ? pattern.slice(1) : pattern),
		);
		if (relativePattern) throw new Error(`Context preload preset pattern must be absolute: ${relativePattern}`);
	}
	const inherited = await pMap(
		config.extends ?? [],
		async (preset) =>
			loadPatterns(join(presetDirectory, `${preset}.yml`), presetDirectory, signal, [...ancestors, path]),
		{ concurrency: CONCURRENCY, signal },
	);
	return [...inherited.flat(), ...ownPatterns];
}

export async function collectPreload(cwd: string, signal: AbortSignal, presetDirectory = DEFAULT_PRESET_DIRECTORY) {
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
	const configBytes = config.stats?.size;
	if (configBytes === undefined) throw new Error("Could not read CONTEXT_PRELOAD.yml metadata.");
	if (configBytes > MAX_FILE_BYTES) {
		throw new Error(`CONTEXT_PRELOAD.yml exceeds ${formatSize(MAX_FILE_BYTES)}.`);
	}

	const patterns = await loadPatterns(resolve(cwd, config.path), presetDirectory, signal);
	signal.throwIfAborted();
	if (patterns.length === 0) return;
	const includePatterns = patterns.filter((pattern) => !pattern.startsWith("!"));
	const ignorePatterns = patterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1));

	const files = await globby(includePatterns, {
		cwd,
		gitignore: true,
		ignore: [...LOCK_FILE_GLOBS, ...ignorePatterns],
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
		const fileBytes = file.stats?.size;
		if (fileBytes === undefined) throw new Error(`Could not read file metadata: ${file.path}`);
		if (fileBytes > MAX_FILE_BYTES) {
			throw new Error(`${file.path} is ${formatSize(fileBytes)}; the file limit is ${formatSize(MAX_FILE_BYTES)}.`);
		}
		return total + fileBytes;
	}, 0);
	if (expectedBytes > MAX_TOTAL_BYTES) {
		throw new Error(`Selected files total ${formatSize(expectedBytes)}; the limit is ${formatSize(MAX_TOTAL_BYTES)}.`);
	}

	let loadedBytes = 0;
	const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
	const blocks = await pMap(
		files,
		async (file) => {
			const bytes = await readFile(resolve(cwd, file.path), { signal });
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
		const hasPreload = ctx.sessionManager
			.buildContextEntries()
			.some(
				(entry) =>
					entry.type === "message" && entry.message.role === "custom" && entry.message.customType === CUSTOM_TYPE,
			);
		if (!ctx.isProjectTrusted() || hasPreload) return;

		ctx.ui.setStatus(CUSTOM_TYPE, "Preloading context...");

		try {
			const signal = AbortSignal.timeout(DEADLINE_MS);
			const result = await collectPreload(ctx.cwd, signal);
			if (!result) return;

			pi.sendMessage({ customType: CUSTOM_TYPE, content: result.blocks, display: false }, { triggerTurn: false });
			ctx.ui.notify(`Context preloaded: ${result.count} files — ${formatSize(result.bytes)}`, "info");
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Context preload failed: ${detail}`, "error");
			throw error;
		} finally {
			ctx.ui.setStatus(CUSTOM_TYPE, undefined);
		}
	});
}
