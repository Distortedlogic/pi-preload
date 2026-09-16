import type { Stats } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { type ExtensionAPI, formatSize } from "@earendil-works/pi-coding-agent";
import { fileTypeFromBuffer } from "file-type";
import { globby, isDynamicPattern } from "globby";
import { isBinaryFile } from "isbinaryfile";
import nunjucks from "nunjucks";
import pMap from "p-map";
import { readYamlFile } from "read-yaml-file";
import { Value } from "typebox/value";
import { type Configuration, configurationSchema } from "./agents.ts";

const CUSTOM_TYPE = "context-preload";
const OWNED_SECTION_PATH = "pi-context-preload";
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
const TREE_FILE = "TREE.txt";
const PRELOAD_FILE = "PRELOAD.md";
const CONCURRENCY = 8;
const DEADLINE_MS = 30_000;
const DEFAULT_PRESET_DIRECTORY = fileURLToPath(new URL("./presets/", import.meta.url));
const DEFAULT_CONTEXT_DIRECTORY = fileURLToPath(new URL("./context/", import.meta.url));
const CONTEXT_FACTS_FILE = "facts.ts";
const CONTEXT_TEMPLATE_FILE = "index.md.njk";
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

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadYamlConfiguration(sourcePath: string): Promise<Configuration>;
async function loadYamlConfiguration(
	sourcePath: string,
	select: (document: unknown) => unknown,
): Promise<Configuration | undefined>;
async function loadYamlConfiguration(sourcePath: string, select?: (document: unknown) => unknown) {
	let document: unknown;
	try {
		document = await readYamlFile(sourcePath);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Could not parse ${sourcePath} at ${OWNED_SECTION_PATH}: ${detail}`, { cause: error });
	}

	const value = select ? select(document) : document;
	if (select && value === undefined) return;
	try {
		return Value.Parse(configurationSchema, value);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid configuration in ${sourcePath} at ${OWNED_SECTION_PATH}: ${detail}`, { cause: error });
	}
}

function getOwnedConfiguration(document: unknown) {
	if (!isObject(document)) return;
	return document["pi-context-preload"];
}

async function loadProjectConfiguration(cwd: string, signal: AbortSignal) {
	const [source] = await globby("AGENTS.yml", {
		cwd,
		onlyFiles: false,
		followSymbolicLinks: false,
		objectMode: true,
		stats: true,
	});
	signal.throwIfAborted();
	if (!source) return;

	const sourcePath = resolve(cwd, source.path);
	if (!source.dirent.isFile()) {
		throw new Error(`Invalid configuration source ${sourcePath} at ${OWNED_SECTION_PATH}: expected a regular file.`);
	}
	const sourceBytes = source.stats?.size;
	if (sourceBytes === undefined) {
		throw new Error(`Could not read configuration metadata for ${sourcePath} at ${OWNED_SECTION_PATH}.`);
	}
	if (sourceBytes > MAX_FILE_BYTES) {
		throw new Error(`${sourcePath} at ${OWNED_SECTION_PATH} exceeds ${formatSize(MAX_FILE_BYTES)}.`);
	}

	return loadYamlConfiguration(sourcePath, getOwnedConfiguration);
}

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
	configValue?: Configuration,
): Promise<PreloadConfiguration> {
	const path = resolve(configPath);
	if (ancestors.includes(path)) throw new Error(`Circular context preload preset: ${path}`);
	const config = configValue === undefined ? await loadYamlConfiguration(path) : configValue;
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

export async function collectPreload(
	cwd: string,
	signal: AbortSignal,
	presetDirectory = DEFAULT_PRESET_DIRECTORY,
	contextDirectory = DEFAULT_CONTEXT_DIRECTORY,
	configuration: Configuration,
) {
	const resolvedConfiguration = await loadConfiguration(
		resolve(cwd, "AGENTS.yml"),
		presetDirectory,
		signal,
		[],
		configuration,
	);
	const { files: patterns, contexts } = resolvedConfiguration;
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
					ignore: ["AGENTS.yml", PRELOAD_FILE, TREE_FILE, ...LOCK_FILE_GLOBS, ...ignorePatterns],
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

	let selectedFileBytes = 0;
	const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
	const fileBlocks = await pMap(
		files,
		async (file): Promise<PreloadBlock[]> => {
			const path = resolve(cwd, file.path);
			const bytes = await readFile(path, { signal });
			if (bytes.length > MAX_FILE_BYTES) {
				throw new Error(`${file.path} grew beyond ${formatSize(MAX_FILE_BYTES)}.`);
			}
			selectedFileBytes += bytes.length;
			if (selectedFileBytes > MAX_TOTAL_BYTES) {
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
			const label = JSON.stringify(file.path);
			const newline = text.endsWith("\n") ? "" : "\n";
			return [
				{
					type: "text",
					text: `===== BEGIN FILE ${label} =====\n${text}${newline}===== END FILE ${label} =====`,
				},
			];
		},
		{ concurrency: CONCURRENCY, signal },
	);
	const blocks: PreloadBlock[] = [...contextBlocks, ...fileBlocks.flat()];

	const preloadContextBytes = blocks.reduce((total, block) => total + blockBytes(block), 0);
	if (preloadContextBytes > MAX_TOTAL_BYTES) {
		throw new Error(`Context with headings is over ${formatSize(MAX_TOTAL_BYTES)}.`);
	}

	signal.throwIfAborted();
	const validatedPreloadSnapshot = serializePreloadBlocks(blocks);
	await writeFile(resolve(cwd, PRELOAD_FILE), validatedPreloadSnapshot, { encoding: "utf8", signal });
	return { blocks, count: files.length, bytes: selectedFileBytes };
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
			const configuration = await loadProjectConfiguration(ctx.cwd, signal);
			if (!configuration) return;
			const result = await collectPreload(
				ctx.cwd,
				signal,
				DEFAULT_PRESET_DIRECTORY,
				DEFAULT_CONTEXT_DIRECTORY,
				configuration,
			);
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
