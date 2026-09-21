import type { Stats } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
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
import { type Configuration, configurationSchema } from "../agents.ts";
import { foldSignatures } from "./fold.ts";
import { type SignatureLanguage, signatureLanguage } from "./languages.ts";

const CUSTOM_TYPE = "pi-preload";
const OWNED_SECTION_PATH = "pi-preload";
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
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 1000;
const TREE_FILE = "TREE.txt";
const PRELOAD_FILE = "PRELOAD.md";
const CONCURRENCY = 8;
const DEADLINE_MS = 30_000;
const DEFAULT_PRESET_DIRECTORY = fileURLToPath(new URL("../presets/", import.meta.url));
const DEFAULT_CONTEXT_DIRECTORY = fileURLToPath(new URL("../context/", import.meta.url));
const CONTEXT_FACTS_FILE = "facts.ts";
const CONTEXT_TEMPLATE_FILE = "index.md.njk";
type PreloadBlock = TextContent | ImageContent;
type SelectionMode = "full" | "signatures";

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

type PreloadConfiguration = { includes: string[]; signatures: string[]; excludes: string[]; contexts: string[] };
type ProjectScope = {
	projectRoot: string;
	includes: string[];
	signatures: string[];
	excludes: string[];
	contexts: string[];
};
type ContextFactsLoader = (input: { cwd: string; signal: AbortSignal }) => Promise<Record<string, unknown> | undefined>;
type ContextSource = { name: string; facts: Record<string, unknown>; templatePath: string };
type ContextReference = { projectRoot: string; name: string };

export class SignatureBinaryFileError extends Error {
	constructor(path: string) {
		super(`Signature folding requires a text file, but ${path} is binary.`);
		this.name = "SignatureBinaryFileError";
	}
}

export class UnsupportedSignatureLanguageError extends Error {
	constructor(path: string) {
		super(`Signature folding does not support the file extension for ${path}.`);
		this.name = "UnsupportedSignatureLanguageError";
	}
}

const CONTEXT_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const PRESET_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

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

function selectOwnedSection(document: unknown) {
	return typeof document === "object" && document !== null && !Array.isArray(document)
		? (document as Record<string, unknown>)[OWNED_SECTION_PATH]
		: undefined;
}

async function statProjectConfiguration(sourcePath: string, signal: AbortSignal) {
	signal.throwIfAborted();
	let sourceStats: Stats;
	try {
		sourceStats = await stat(sourcePath);
	} catch (error) {
		signal.throwIfAborted();
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
		throw error;
	}
	signal.throwIfAborted();
	if (!sourceStats.isFile()) {
		throw new Error(`Invalid configuration source ${sourcePath} at ${OWNED_SECTION_PATH}: expected a regular file.`);
	}
	if (sourceStats.size > MAX_FILE_BYTES) {
		throw new Error(`${sourcePath} at ${OWNED_SECTION_PATH} exceeds ${formatSize(MAX_FILE_BYTES)}.`);
	}
	return sourceStats;
}

async function loadProjectConfiguration(cwd: string, signal: AbortSignal) {
	const sourcePath = resolve(cwd, "AGENTS.yml");
	if (!(await statProjectConfiguration(sourcePath, signal))) return;
	return loadYamlConfiguration(sourcePath, selectOwnedSection);
}

async function loadReferencedProjectConfiguration(sourcePath: string, signal: AbortSignal) {
	if (!(await statProjectConfiguration(sourcePath, signal))) {
		throw new Error(`Referenced project configuration not found: ${sourcePath}`);
	}
	const configuration = await loadYamlConfiguration(sourcePath, selectOwnedSection);
	if (!configuration) {
		throw new Error(`Referenced project configuration ${sourcePath} has no ${OWNED_SECTION_PATH} section.`);
	}
	return configuration;
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

function resolvePresetPath(presetDirectory: string, preset: string) {
	if (!PRESET_NAME_PATTERN.test(preset)) {
		throw new Error(`Invalid context preload preset name: ${JSON.stringify(preset)}`);
	}
	return resolve(presetDirectory, `${preset}.yml`);
}

async function loadPresetConfiguration(
	config: Configuration,
	configPath: string,
	presetDirectory: string,
	signal: AbortSignal,
	ancestors: string[],
): Promise<PreloadConfiguration> {
	const path = resolve(configPath);
	if (ancestors.includes(path)) throw new Error(`Circular context preload preset: ${path}`);
	if (config.extends?.length) {
		throw new Error(`Context preload preset ${path} cannot extend project paths; use presets.`);
	}
	const ownIncludes = config.includes ?? [];
	const ownSignatures = config.signatures ?? [];
	const ownExcludes = config.excludes ?? [];
	const relativePattern = [...ownIncludes, ...ownSignatures, ...ownExcludes].find((pattern) => !isAbsolute(pattern));
	if (relativePattern) throw new Error(`Context preload preset pattern must be absolute: ${relativePattern}`);
	const ownContexts = config.contexts ?? [];
	const nextAncestors = [...ancestors, path];
	const inherited = await pMap(
		config.presets ?? [],
		async (preset) => {
			const presetPath = resolvePresetPath(presetDirectory, preset);
			if (nextAncestors.includes(presetPath)) throw new Error(`Circular context preload preset: ${presetPath}`);
			const presetConfiguration = await loadYamlConfiguration(presetPath);
			return loadPresetConfiguration(presetConfiguration, presetPath, presetDirectory, signal, nextAncestors);
		},
		{ concurrency: CONCURRENCY, signal },
	);
	return {
		includes: [...inherited.flatMap((configuration) => configuration.includes), ...ownIncludes],
		signatures: [...inherited.flatMap((configuration) => configuration.signatures), ...ownSignatures],
		excludes: [...inherited.flatMap((configuration) => configuration.excludes), ...ownExcludes],
		contexts: [...new Set([...inherited.flatMap((configuration) => configuration.contexts), ...ownContexts])],
	};
}

async function loadConfiguration(
	config: Configuration,
	configPath: string,
	presetDirectory: string,
	signal: AbortSignal,
	ancestors: string[] = [],
): Promise<ProjectScope[]> {
	const path = resolve(configPath);
	if (ancestors.includes(path)) throw new Error(`Circular context preload preset: ${path}`);
	const nextAncestors = [...ancestors, path];
	const ownIncludes = config.includes ?? [];
	const ownSignatures = config.signatures ?? [];
	const ownExcludes = config.excludes ?? [];
	const ownContexts = config.contexts ?? [];
	const presets = await pMap(
		config.presets ?? [],
		async (preset) => {
			const presetPath = resolvePresetPath(presetDirectory, preset);
			if (nextAncestors.includes(presetPath)) throw new Error(`Circular context preload preset: ${presetPath}`);
			const presetConfiguration = await loadYamlConfiguration(presetPath);
			return loadPresetConfiguration(presetConfiguration, presetPath, presetDirectory, signal, nextAncestors);
		},
		{ concurrency: CONCURRENCY, signal },
	);
	const scopes = await pMap(
		config.extends ?? [],
		async (reference) => {
			const referencePath = resolve(dirname(path), reference, "AGENTS.yml");
			if (nextAncestors.includes(referencePath)) {
				throw new Error(`Circular context preload preset: ${referencePath}`);
			}
			const referenceConfiguration = await loadReferencedProjectConfiguration(referencePath, signal);
			return loadConfiguration(referenceConfiguration, referencePath, presetDirectory, signal, nextAncestors);
		},
		{ concurrency: CONCURRENCY, signal },
	);
	return [
		...scopes.flat(),
		{
			projectRoot: dirname(path),
			includes: [...presets.flatMap((preset) => preset.includes), ...ownIncludes],
			signatures: [...presets.flatMap((preset) => preset.signatures), ...ownSignatures],
			excludes: [...presets.flatMap((preset) => preset.excludes), ...ownExcludes],
			contexts: [...new Set([...presets.flatMap((preset) => preset.contexts), ...ownContexts])],
		},
	];
}

async function loadContextSource(
	cwd: string,
	name: string,
	contextRoot: string,
	signal: AbortSignal,
): Promise<ContextSource | undefined> {
	const factsPath = resolve(contextRoot, name, CONTEXT_FACTS_FILE);
	const templatePath = resolve(contextRoot, name, CONTEXT_TEMPLATE_FILE);
	signal.throwIfAborted();
	let contextModule: { default?: unknown };
	try {
		contextModule = (await import(pathToFileURL(factsPath).href)) as { default?: unknown };
	} catch (error) {
		signal.throwIfAborted();
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Context source ${name} import failed: ${detail}`, { cause: error });
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
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Context source ${name} execution failed: ${detail}`, { cause: error });
	}
	signal.throwIfAborted();
	return facts === undefined ? undefined : { name, facts, templatePath };
}

async function loadContextSources(references: ContextReference[], contextDirectory: string, signal: AbortSignal) {
	if (references.length === 0) return [];
	const seen = new Set<string>();
	const uniqueReferences: ContextReference[] = [];
	for (const reference of references) {
		validateContextName(reference.name);
		const key = `${reference.projectRoot}\0${reference.name}`;
		if (seen.has(key)) continue;
		seen.add(key);
		uniqueReferences.push(reference);
	}
	const contextRoot = resolve(contextDirectory);
	const environment = new nunjucks.Environment(new nunjucks.FileSystemLoader(contextRoot, { noCache: true }), {
		autoescape: false,
		throwOnUndefined: true,
	});
	const blocks: TextContent[] = [];
	for (const { projectRoot, name } of uniqueReferences) {
		const source = await loadContextSource(projectRoot, name, contextRoot, signal);
		if (!source) continue;
		let rendered: string;
		signal.throwIfAborted();
		try {
			rendered = environment.render(source.templatePath, { facts: source.facts });
		} catch (error) {
			signal.throwIfAborted();
			const detail = error instanceof Error ? error.message : String(error);
			throw new Error(`Context source ${source.name} render failed: ${detail}`, { cause: error });
		}
		signal.throwIfAborted();
		const markdown = rendered.replace(/\r\n?/g, "\n").trimEnd();
		if (markdown.trim().length === 0) throw new Error(`Context source ${source.name} rendered empty content.`);
		const block: TextContent = { type: "text", text: `Context: ${source.name}\n\n${markdown}\n` };
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
	const scopes = await loadConfiguration(configuration, resolve(cwd, "AGENTS.yml"), presetDirectory, signal);
	const contextBlocks = await loadContextSources(
		scopes.flatMap((scope) => scope.contexts.map((name) => ({ projectRoot: scope.projectRoot, name }))),
		contextDirectory,
		signal,
	);
	signal.throwIfAborted();

	const sessionRoot = resolve(cwd);
	const scopedCandidates = await pMap(
		scopes,
		async (scope) => {
			if (scope.includes.length === 0 && scope.signatures.length === 0) return [];
			const sessionScope = scope.projectRoot === sessionRoot;
			const [signatureMatches, fullMatches] = await Promise.all([
				globby(scope.signatures, {
					cwd: scope.projectRoot,
					gitignore: sessionScope,
					ignoreFiles: sessionScope ? undefined : "**/.gitignore",
					ignore: ["AGENTS.yml", PRELOAD_FILE, TREE_FILE, ...LOCK_FILE_GLOBS, ...scope.excludes],
					onlyFiles: true,
					followSymbolicLinks: false,
					unique: true,
					objectMode: true,
					stats: true,
				}),
				globby(scope.includes, {
					cwd: scope.projectRoot,
					gitignore: sessionScope,
					ignoreFiles: sessionScope ? undefined : "**/.gitignore",
					ignore: ["AGENTS.yml", PRELOAD_FILE, TREE_FILE, ...LOCK_FILE_GLOBS, ...scope.excludes],
					onlyFiles: true,
					followSymbolicLinks: false,
					unique: true,
					objectMode: true,
					stats: true,
				}),
			]);
			return [
				...signatureMatches.map((file) => ({
					file,
					projectRoot: scope.projectRoot,
					mode: "signatures" as SelectionMode,
				})),
				...fullMatches.map((file) => ({ file, projectRoot: scope.projectRoot, mode: "full" as SelectionMode })),
			];
		},
		{ concurrency: CONCURRENCY, signal },
	);
	const matchedCandidates = scopedCandidates.flat();
	const candidates = new Map(
		(["signatures", "full"] as const).flatMap((mode) =>
			matchedCandidates
				.filter((candidate) => candidate.mode === mode)
				.map(({ file, projectRoot }) => {
					const path = resolve(projectRoot, file.path);
					return [path, { file, path, mode }] as const;
				}),
		),
	);
	signal.throwIfAborted();

	const explicitFilePaths = new Set(
		scopes.flatMap((scope) =>
			scope.includes
				.filter((pattern) => !isDynamicPattern(pattern))
				.map((pattern) => resolve(scope.projectRoot, pattern)),
		),
	);
	const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
	const selectedFiles = await pMap(
		[...candidates.values()],
		async ({ file, path, mode }) => {
			const bytes = await readFile(path, { signal });
			const binary = await isBinaryFile(bytes);
			if (binary && mode === "signatures") throw new SignatureBinaryFileError(file.path);
			if (binary && !explicitFilePaths.has(path)) return;
			if (!file.dirent.isFile()) throw new Error(`Not a regular file: ${file.path}`);
			const fileBytes = file.stats?.size;
			if (fileBytes === undefined) throw new Error(`Could not read file metadata: ${file.path}`);
			if (fileBytes > MAX_FILE_BYTES) {
				throw new Error(`${file.path} is ${formatSize(fileBytes)}; the file limit is ${formatSize(MAX_FILE_BYTES)}.`);
			}
			if (bytes.length > MAX_FILE_BYTES) {
				throw new Error(`${file.path} grew beyond ${formatSize(MAX_FILE_BYTES)}.`);
			}

			if (binary) {
				const labelPath = relative(cwd, path);
				const fileType = await fileTypeFromBuffer(bytes);
				if (!fileType?.mime.startsWith("image/")) {
					throw new Error(`${file.path} is an explicitly selected binary file, but Pi context supports only images.`);
				}
				return {
					file,
					path,
					mode,
					bytes: bytes.length,
					text: undefined,
					registry: undefined,
					blocks: [
						{ type: "text" as const, text: `File: ${labelPath}` },
						{ type: "image" as const, data: bytes.toString("base64"), mimeType: fileType.mime },
					],
				};
			}

			const registry: SignatureLanguage | undefined = mode === "signatures" ? signatureLanguage(path) : undefined;
			if (mode === "signatures" && !registry) throw new UnsupportedSignatureLanguageError(file.path);
			let text: string;
			try {
				text = decoder.decode(bytes);
			} catch {
				throw new Error(`${file.path} is not valid UTF-8 text.`);
			}
			return { file, path, mode, bytes: bytes.length, text, registry, blocks: undefined };
		},
		{ concurrency: CONCURRENCY, signal },
	);
	const selectedSources = selectedFiles.filter((file) => file !== undefined);
	const signatureSources = selectedSources.flatMap((file) =>
		file.mode === "signatures" && file.text !== undefined && file.registry
			? [{ path: file.path, content: file.text, registry: file.registry }]
			: [],
	);
	const foldedSignatures =
		signatureSources.length > 0 ? await foldSignatures(signatureSources) : new Map<string, string>();
	const files = selectedSources.map((source) => {
		if (source.blocks !== undefined) return { file: source.file, bytes: source.bytes, blocks: source.blocks };
		const text = source.mode === "signatures" ? foldedSignatures.get(source.path) : source.text;
		if (text === undefined) throw new Error(`Signature folding returned no output for ${source.file.path}.`);
		const label = JSON.stringify(relative(cwd, source.path));
		const newline = text.endsWith("\n") ? "" : "\n";
		return {
			file: source.file,
			bytes: source.bytes,
			blocks: [
				{
					type: "text" as const,
					text: `===== BEGIN FILE ${label} =====\n${text}${newline}===== END FILE ${label} =====`,
				},
			],
		};
	});
	signal.throwIfAborted();
	if (files.length > MAX_FILES) throw new Error(`Preload has more than ${MAX_FILES} files.`);
	files.sort(
		(a, b) => dirname(a.file.path).localeCompare(dirname(b.file.path)) || a.file.path.localeCompare(b.file.path),
	);
	const originalSourceBytes = files.reduce((total, file) => total + file.bytes, 0);
	const blocks: PreloadBlock[] = [...contextBlocks, ...files.flatMap((file) => file.blocks)];
	for (const block of blocks) {
		const emittedBlockBytes = blockBytes(block);
		if (emittedBlockBytes > MAX_FILE_BYTES) {
			throw new Error(
				`Emitted context block is ${formatSize(emittedBlockBytes)}; the block limit is ${formatSize(MAX_FILE_BYTES)}.`,
			);
		}
	}
	const validatedPreloadSnapshot = serializePreloadBlocks(blocks);
	const emittedContextBytes = Buffer.byteLength(validatedPreloadSnapshot);
	if (emittedContextBytes > MAX_TOTAL_BYTES) {
		throw new Error(`Context with headings is over ${formatSize(MAX_TOTAL_BYTES)}.`);
	}

	signal.throwIfAborted();
	await writeFile(resolve(cwd, PRELOAD_FILE), validatedPreloadSnapshot, { encoding: "utf8", signal });
	return {
		blocks,
		count: files.length,
		contextBytes: emittedContextBytes,
		sourceBytes: originalSourceBytes,
	};
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const hasPreload = ctx.sessionManager
			.buildContextEntries()
			.some((entry) => entry.type === "custom_message" && entry.customType === CUSTOM_TYPE);
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
			pi.sendMessage({ customType: CUSTOM_TYPE, content: result.blocks, display: false }, { triggerTurn: false });
			ctx.ui.notify(
				`Context preloaded: ${result.count} files — ${formatSize(result.contextBytes)} context from ${formatSize(result.sourceBytes)} source`,
				"info",
			);
		} finally {
			ctx.ui.setStatus(CUSTOM_TYPE, undefined);
		}
	});
}
