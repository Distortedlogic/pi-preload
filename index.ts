import { execFile } from "node:child_process";
import type { Stats } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { type ExtensionAPI, formatSize } from "@earendil-works/pi-coding-agent";
import { fileTypeFromBuffer } from "file-type";
import { globby, isDynamicPattern } from "globby";
import { isBinaryFile } from "isbinaryfile";
import nunjucks from "nunjucks";
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
		contexts: Type.Optional(GLOB_LIST),
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
const PRELOAD_FILE = "PRELOAD.md";
const TREE_BLOCK_HEADING = `File: ${TREE_FILE}\n\n`;
const MAX_TREE_OUTPUT_BYTES = MAX_TREE_BYTES - Buffer.byteLength(TREE_BLOCK_HEADING) - 1;
const ON_DEMAND_TREE_DIRECTORIES = new Set(["__tests__", "test", "tests"]);
const CONCURRENCY = 8;
const DEADLINE_MS = 30_000;
const DEFAULT_PRESET_DIRECTORY = fileURLToPath(new URL("./presets/", import.meta.url));
const DEFAULT_CONTEXT_DIRECTORY = fileURLToPath(new URL("./context/", import.meta.url));
const CONTEXT_FACTS_FILE = "facts.ts";
const CONTEXT_TEMPLATE_FILE = "index.md.njk";
const execFileAsync = promisify(execFile);
type PreloadBlock = TextContent | ImageContent;

function blockBytes(block: PreloadBlock) {
	return block.type === "text" ? Buffer.byteLength(block.text) : Buffer.byteLength(block.data);
}

function serializePreloadBlocks(blocks: readonly PreloadBlock[]) {
	return `${blocks
		.map((block) =>
			block.type === "text" ? block.text : `![Preloaded image](data:${block.mimeType};base64,${block.data})`,
		)
		.join("\n\n")}\n`;
}

type PreloadConfiguration = { files: string[]; contexts: string[] };
type ContextFactsLoader = (input: { cwd: string; signal: AbortSignal }) => Promise<Record<string, unknown> | undefined>;
type ContextSource = { name: string; facts: Record<string, unknown> };

const CONTEXT_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

function validateContextName(name: string) {
	const segments = name.split(/[\\/]/);
	if (
		isAbsolute(name) ||
		segments.length !== 1 ||
		segments.some((segment) => segment === "." || segment === "..") ||
		!CONTEXT_NAME_PATTERN.test(name)
	) {
		throw new Error(`Invalid context source name: ${JSON.stringify(name)}`);
	}
}

async function loadConfiguration(
	configPath: string,
	presetDirectory: string,
	signal: AbortSignal,
	ancestors: string[] = [],
): Promise<PreloadConfiguration> {
	const path = resolve(configPath);
	if (ancestors.includes(path)) throw new Error(`Circular context preload preset: ${path}`);
	const config = Value.Parse(PRELOAD_CONFIG, await readYamlFile(path));
	const ownFiles = config.files ?? [];
	if (ancestors.length > 0) {
		const relativePattern = ownFiles.find(
			(pattern) => !isAbsolute(pattern.startsWith("!") ? pattern.slice(1) : pattern),
		);
		if (relativePattern) throw new Error(`Context preload preset pattern must be absolute: ${relativePattern}`);
	}
	const ownContexts = config.contexts ?? [];
	for (const context of ownContexts) validateContextName(context);
	const inherited = await pMap(
		config.extends ?? [],
		async (preset) =>
			loadConfiguration(join(presetDirectory, `${preset}.yml`), presetDirectory, signal, [...ancestors, path]),
		{ concurrency: CONCURRENCY, signal },
	);
	return {
		files: [...inherited.flatMap((configuration) => configuration.files), ...ownFiles],
		contexts: [...new Set([...inherited.flatMap((configuration) => configuration.contexts), ...ownContexts])],
	};
}

function isPathInside(directory: string, path: string) {
	const relativePath = relative(directory, path);
	return (
		relativePath !== "" && relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)
	);
}

function resolveContextSourcePaths(contextRoot: string, name: string) {
	validateContextName(name);
	const factsPath = resolve(contextRoot, name, CONTEXT_FACTS_FILE);
	const templatePath = resolve(contextRoot, name, CONTEXT_TEMPLATE_FILE);
	if (!isPathInside(contextRoot, factsPath) || !isPathInside(contextRoot, templatePath)) {
		throw new Error(`Invalid context source name: ${JSON.stringify(name)}`);
	}
	return { factsPath, templatePath };
}

function contextSourceError(name: string, operation: string, error: unknown) {
	const detail = error instanceof Error ? error.message : String(error);
	return new Error(`Context source ${name} ${operation} failed: ${detail}`, { cause: error });
}

async function loadContextSource(
	cwd: string,
	name: string,
	contextRoot: string,
	signal: AbortSignal,
): Promise<ContextSource | undefined> {
	const { factsPath, templatePath } = resolveContextSourcePaths(contextRoot, name);
	signal.throwIfAborted();
	let entryStats: Stats[];
	try {
		entryStats = await Promise.all([stat(factsPath), stat(templatePath)]);
	} catch {
		signal.throwIfAborted();
		throw new Error(`Unknown context source: ${name}`);
	}
	if (entryStats.some((entry) => !entry.isFile())) throw new Error(`Unknown context source: ${name}`);
	signal.throwIfAborted();

	let contextModule: { default?: unknown };
	try {
		contextModule = (await import(pathToFileURL(factsPath).href)) as { default?: unknown };
	} catch (error) {
		signal.throwIfAborted();
		throw contextSourceError(name, "import", error);
	}
	const loader = contextModule.default;
	if (typeof loader !== "function") {
		throw new Error(`Context source ${name} facts.ts default export must be a function.`);
	}
	signal.throwIfAborted();

	let facts: Record<string, unknown> | undefined;
	try {
		facts = await (loader as ContextFactsLoader)({ cwd, signal });
	} catch (error) {
		signal.throwIfAborted();
		throw contextSourceError(name, "execution", error);
	}
	signal.throwIfAborted();
	return facts === undefined ? undefined : { name, facts };
}

function renderContextSource(
	source: ContextSource,
	environment: nunjucks.Environment,
	signal: AbortSignal,
): TextContent {
	let rendered: string;
	signal.throwIfAborted();
	try {
		rendered = environment.render(`${source.name}/${CONTEXT_TEMPLATE_FILE}`, { facts: source.facts });
	} catch (error) {
		signal.throwIfAborted();
		throw contextSourceError(source.name, "render", error);
	}
	signal.throwIfAborted();
	const markdown = rendered.replace(/\r\n?/g, "\n").trimEnd();
	if (markdown.trim().length === 0) throw new Error(`Context source ${source.name} rendered empty content.`);
	return { type: "text", text: `Context: ${source.name}\n\n${markdown}\n` };
}

async function loadContextSources(cwd: string, names: string[], contextDirectory: string, signal: AbortSignal) {
	if (names.length === 0) return [];
	const contextRoot = resolve(contextDirectory);
	const environment = new nunjucks.Environment(new nunjucks.FileSystemLoader(contextRoot, { noCache: true }), {
		autoescape: false,
		throwOnUndefined: true,
	});
	const blocks: TextContent[] = [];
	for (const name of names) {
		const source = await loadContextSource(cwd, name, contextRoot, signal);
		if (!source) continue;
		const block = renderContextSource(source, environment, signal);
		const bytes = blockBytes(block);
		if (bytes > MAX_FILE_BYTES) {
			throw new Error(
				`Context source ${source.name} is ${formatSize(bytes)}; the block limit is ${formatSize(MAX_FILE_BYTES)}.`,
			);
		}
		blocks.push(block);
	}
	return blocks;
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
				PRELOAD_FILE,
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

export async function collectPreload(
	cwd: string,
	signal: AbortSignal,
	presetDirectory = DEFAULT_PRESET_DIRECTORY,
	contextDirectory = DEFAULT_CONTEXT_DIRECTORY,
) {
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

	const { files: patterns, contexts } = await loadConfiguration(resolve(cwd, config.path), presetDirectory, signal);
	const contextBlocks = await loadContextSources(cwd, contexts, contextDirectory, signal);
	signal.throwIfAborted();
	const includePatterns = patterns.filter((pattern) => !pattern.startsWith("!"));
	const ignorePatterns = patterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1));

	const candidates =
		includePatterns.length === 0
			? []
			: await globby(includePatterns, {
					cwd,
					gitignore: true,
					ignore: [PRELOAD_FILE, TREE_FILE, ...LOCK_FILE_GLOBS, ...ignorePatterns],
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
	const blocks: PreloadBlock[] = [...contextBlocks, ...fileBlocks.flat()];

	const preloadContextBytes = blocks.reduce((total, block) => total + blockBytes(block), 0);
	if (preloadContextBytes > MAX_TOTAL_BYTES) {
		throw new Error(`Context with headings is over ${formatSize(MAX_TOTAL_BYTES)}.`);
	}

	signal.throwIfAborted();
	const treeBlock = await collectFilesystemTree(cwd, ignorePatterns, signal);
	signal.throwIfAborted();
	blocks.push(treeBlock);
	const contextBytes = blocks.reduce((total, block) => total + blockBytes(block), 0);
	if (contextBytes > MAX_TOTAL_BYTES + MAX_TREE_BYTES) {
		throw new Error(`Context with filesystem tree is over ${formatSize(MAX_TOTAL_BYTES + MAX_TREE_BYTES)}.`);
	}
	const preloadSnapshot = serializePreloadBlocks(blocks);
	await writeFile(resolve(cwd, PRELOAD_FILE), preloadSnapshot, { encoding: "utf8", signal });
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
