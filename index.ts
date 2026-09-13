import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { type ExtensionAPI, formatSize } from "@earendil-works/pi-coding-agent";
import { fileTypeFromBuffer } from "file-type";
import { globby, isDynamicPattern } from "globby";
import { isBinaryFile } from "isbinaryfile";
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
const MAX_TREE_BYTES = 16 * 1024;
const TREE_FILE = "TREE.txt";
const TREE_BLOCK_HEADING = `File: ${TREE_FILE}\n\n`;
const MAX_TREE_OUTPUT_BYTES = MAX_TREE_BYTES - Buffer.byteLength(TREE_BLOCK_HEADING) - 1;
const ON_DEMAND_TREE_DIRECTORIES = new Set(["__tests__", "test", "tests"]);
const CONCURRENCY = 8;
const DEADLINE_MS = 30_000;
const DEFAULT_PRESET_DIRECTORY = fileURLToPath(new URL("./presets/", import.meta.url));
const execFileAsync = promisify(execFile);
type PreloadBlock = TextContent | ImageContent;

function blockBytes(block: PreloadBlock) {
	return block.type === "text" ? Buffer.byteLength(block.text) : Buffer.byteLength(block.data);
}

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

function exceededTreeAllocation(error: unknown) {
	return error instanceof Error && "code" in error && error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
}

async function renderFilesystemTree(cwd: string, inputPath: string, paths: string[], signal: AbortSignal) {
	if (paths.length === 0) return ".";
	await writeFile(inputPath, `${paths.join("\n")}\n`, { encoding: "utf8", signal });
	try {
		const { stdout } = await execFileAsync(
			"tree",
			["-n", "-q", "--dirsfirst", "--noreport", "--charset", "UTF-8", "--fromfile", "--", inputPath],
			{ cwd, encoding: "utf8", maxBuffer: MAX_TREE_OUTPUT_BYTES, signal },
		);
		return stdout.trimEnd();
	} catch (error) {
		if (exceededTreeAllocation(error)) return;
		throw error;
	}
}

async function collectFilesystemTree(cwd: string, ignorePatterns: string[], signal: AbortSignal) {
	const entries = (
		await globby("**/*", {
			cwd,
			dot: true,
			gitignore: true,
			ignore: [
				".git",
				".git/**",
				"**/.git",
				"**/.git/**",
				"CONTEXT_PRELOAD.yml",
				TREE_FILE,
				...LOCK_FILE_GLOBS,
				...ignorePatterns,
			],
			onlyFiles: false,
			followSymbolicLinks: false,
			unique: true,
			objectMode: true,
		})
	)
		.filter((entry) => {
			const ancestors = entry.path.split("/").slice(0, -1);
			return !ancestors.some((part) => ON_DEMAND_TREE_DIRECTORIES.has(part.toLowerCase()));
		})
		.map((entry) => ({
			depth: entry.path.split("/").length,
			isDirectory: entry.dirent.isDirectory(),
			path: entry.path,
			treePath: `${entry.path}${entry.dirent.isDirectory() ? "/" : ""}`,
		}))
		.sort((a, b) => a.path.localeCompare(b.path));
	signal.throwIfAborted();

	const temporaryDirectory = await mkdtemp(join(tmpdir(), "pi-context-preload-tree-"));
	const inputPath = join(temporaryDirectory, "paths.txt");
	try {
		const maximumDepth = entries.reduce((maximum, entry) => Math.max(maximum, entry.depth), 0);
		let acceptedDepth = 0;
		let acceptedPaths: string[] = [];
		let acceptedTree = ".";

		for (let depth = 1; depth <= maximumDepth; depth += 1) {
			const candidatePaths = entries.filter((entry) => entry.depth <= depth).map((entry) => entry.treePath);
			const candidateTree = await renderFilesystemTree(cwd, inputPath, candidatePaths, signal);
			if (candidateTree === undefined) break;
			acceptedDepth = depth;
			acceptedPaths = candidatePaths;
			acceptedTree = candidateTree;
		}

		if (acceptedDepth < maximumDepth) {
			const expansionDepth = acceptedDepth + 1;
			const includedPaths = new Set(acceptedPaths);
			const folders = entries.filter(
				(entry) => entry.isDirectory && entry.depth === 1 && !ON_DEMAND_TREE_DIRECTORIES.has(entry.path.toLowerCase()),
			);
			for (const folder of folders) {
				for (const entry of entries) {
					if (
						entry.depth <= expansionDepth &&
						(entry.path === folder.path || entry.path.startsWith(`${folder.path}/`))
					) {
						includedPaths.add(entry.treePath);
					}
				}
				const candidatePaths = entries
					.filter((entry) => includedPaths.has(entry.treePath))
					.map((entry) => entry.treePath);
				const candidateTree = await renderFilesystemTree(cwd, inputPath, candidatePaths, signal);
				if (candidateTree === undefined) break;
				acceptedTree = candidateTree;
			}
		}

		const treeText = `${acceptedTree}\n`;
		await writeFile(resolve(cwd, TREE_FILE), treeText, { encoding: "utf8", signal });
		return { type: "text" as const, text: `${TREE_BLOCK_HEADING}${treeText}` };
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
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
	const includePatterns = patterns.filter((pattern) => !pattern.startsWith("!"));
	const ignorePatterns = patterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1));

	const candidates =
		includePatterns.length === 0
			? []
			: await globby(includePatterns, {
					cwd,
					gitignore: true,
					ignore: [TREE_FILE, ...LOCK_FILE_GLOBS, ...ignorePatterns],
					onlyFiles: true,
					followSymbolicLinks: false,
					unique: true,
					objectMode: true,
					stats: true,
				});
	signal.throwIfAborted();

	const explicitFilePaths = new Set(
		includePatterns.filter((pattern) => !isDynamicPattern(pattern)).map((pattern) => resolve(cwd, pattern)),
	);
	const binaryPaths = new Set<string>();
	const selectedFiles = await pMap(
		candidates,
		async (file) => {
			const path = resolve(cwd, file.path);
			if (!(await isBinaryFile(path))) return file;
			if (!explicitFilePaths.has(path)) return;
			binaryPaths.add(path);
			return file;
		},
		{ concurrency: CONCURRENCY, signal },
	);
	const files = selectedFiles.filter((file) => file !== undefined);
	signal.throwIfAborted();
	if (files.length > MAX_FILES) throw new Error(`Preload has more than ${MAX_FILES} files.`);
	files.sort((a, b) => dirname(a.path).localeCompare(dirname(b.path)) || a.path.localeCompare(b.path));

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
	const fileBlocks = await pMap(
		files,
		async (file): Promise<PreloadBlock[]> => {
			const path = resolve(cwd, file.path);
			const bytes = await readFile(path, { signal });
			if (bytes.length > MAX_FILE_BYTES) {
				throw new Error(`${file.path} grew beyond ${formatSize(MAX_FILE_BYTES)}.`);
			}
			loadedBytes += bytes.length;
			if (loadedBytes > MAX_TOTAL_BYTES) {
				throw new Error(`Selected files grew beyond ${formatSize(MAX_TOTAL_BYTES)}.`);
			}

			if (binaryPaths.has(path)) {
				const fileType = await fileTypeFromBuffer(bytes);
				if (!fileType?.mime.startsWith("image/")) {
					throw new Error(`${file.path} is an explicitly selected binary file, but Pi context supports only images.`);
				}
				return [
					{ type: "text", text: `File: ${file.path}` },
					{ type: "image", data: bytes.toString("base64"), mimeType: fileType.mime },
				];
			}

			let text: string;
			try {
				text = decoder.decode(bytes);
			} catch {
				throw new Error(`${file.path} is not valid UTF-8 text.`);
			}
			return [{ type: "text", text: `File: ${file.path}\n\n${text}` }];
		},
		{ concurrency: CONCURRENCY, signal },
	);
	const blocks = fileBlocks.flat();

	const fileContextBytes = blocks.reduce((total, block) => total + blockBytes(block), 0);
	if (fileContextBytes > MAX_TOTAL_BYTES) {
		throw new Error(`Context with headings is over ${formatSize(MAX_TOTAL_BYTES)}.`);
	}

	blocks.push(await collectFilesystemTree(cwd, ignorePatterns, signal));
	signal.throwIfAborted();
	const contextBytes = blocks.reduce((total, block) => total + blockBytes(block), 0);
	if (contextBytes > MAX_TOTAL_BYTES + MAX_TREE_BYTES) {
		throw new Error(`Context with filesystem tree is over ${formatSize(MAX_TOTAL_BYTES + MAX_TREE_BYTES)}.`);
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
