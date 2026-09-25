import { existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { type ExtensionAPI, formatSize } from "@earendil-works/pi-coding-agent";
import { fileTypeFromBuffer } from "file-type";
import nunjucks from "nunjucks";
import pMap from "p-map";
import {
	AGENTS_FILE_NAME,
	type PiPreloadConfiguration as Configuration,
	resolvePiPreloadSources,
	resolvePreloadFileSelection,
} from "pi-agents-yaml";
import { foldSignatures } from "pi-read-signatures/fold";
import { type SignatureLanguage, signatureLanguage } from "pi-read-signatures/languages";

const CUSTOM_TYPE = "pi-preload";
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 1000;
const PRELOAD_FILE = "PRELOAD.md";
const CONCURRENCY = 8;
const DEADLINE_MS = 30_000;
const DEFAULT_CONTEXT_DIRECTORY = fileURLToPath(new URL("../context/", import.meta.url));
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
	configuration?: Configuration,
	contextDirectory = DEFAULT_CONTEXT_DIRECTORY,
	presetDirectory?: string,
) {
	const resolution = await resolvePiPreloadSources({
		rootPath: cwd,
		...(configuration ? { rootValue: configuration } : {}),
		...(presetDirectory ? { presetDirectory } : {}),
		signal,
	});
	const contextBlocks = await loadContextSources(
		resolution.sources.flatMap((source) =>
			source.section.value.contexts.map((name) => ({ projectRoot: source.rootPath, name })),
		),
		contextDirectory,
		signal,
	);
	signal.throwIfAborted();

	const candidates = await resolvePreloadFileSelection({ resolution, signal });
	const explicitFilePaths = new Set(
		resolution.sources.flatMap((source) =>
			source.section.value.includes.map((pattern) => resolve(source.rootPath, pattern)),
		),
	);
	const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
	const selectedFiles = await pMap(
		candidates,
		async ({ absolutePath: path, displayPath, mode, sourceRoot }) => {
			const bytes = await readFile(path, { signal });
			const fileType = await fileTypeFromBuffer(bytes);
			if (fileType && mode === "signature") throw new SignatureBinaryFileError(displayPath);
			if (fileType && !explicitFilePaths.has(path)) return;
			const fileStats = await stat(path);
			if (!fileStats.isFile()) throw new Error(`Not a regular file: ${displayPath}`);
			const fileBytes = fileStats.size;
			if (fileBytes > MAX_FILE_BYTES) {
				throw new Error(`${displayPath} is ${formatSize(fileBytes)}; the file limit is ${formatSize(MAX_FILE_BYTES)}.`);
			}
			if (bytes.length > MAX_FILE_BYTES) {
				throw new Error(`${displayPath} grew beyond ${formatSize(MAX_FILE_BYTES)}.`);
			}

			const selectionPath = relative(sourceRoot, path);
			if (fileType) {
				if (!fileType.mime.startsWith("image/")) {
					throw new Error(`${displayPath} is an explicitly selected binary file, but Pi context supports only images.`);
				}
				return {
					displayPath,
					selectionPath,
					path,
					mode,
					bytes: bytes.length,
					text: undefined,
					registry: undefined,
					blocks: [
						{ type: "text" as const, text: `File: ${displayPath}` },
						{ type: "image" as const, data: bytes.toString("base64"), mimeType: fileType.mime },
					],
				};
			}

			const registry: SignatureLanguage | undefined = mode === "signature" ? signatureLanguage(path) : undefined;
			if (mode === "signature" && !registry) throw new UnsupportedSignatureLanguageError(displayPath);
			let text: string;
			try {
				text = decoder.decode(bytes);
			} catch {
				if (mode === "signature") throw new SignatureBinaryFileError(displayPath);
				if (!explicitFilePaths.has(path)) return;
				throw new Error(`${displayPath} is an explicitly selected binary file, but Pi context supports only images.`);
			}
			return { displayPath, selectionPath, path, mode, bytes: bytes.length, text, registry, blocks: undefined };
		},
		{ concurrency: CONCURRENCY, signal },
	);
	const selectedSources = selectedFiles.filter((file) => file !== undefined);
	const signatureSources = selectedSources.flatMap((file) =>
		file.mode === "signature" && file.text !== undefined && file.registry
			? [{ path: file.path, content: file.text, registry: file.registry }]
			: [],
	);
	const foldedSignatures =
		signatureSources.length > 0 ? await foldSignatures(signatureSources, signal) : new Map<string, string>();
	const files = selectedSources.map((source) => {
		if (source.blocks !== undefined) {
			return {
				displayPath: source.displayPath,
				selectionPath: source.selectionPath,
				bytes: source.bytes,
				blocks: source.blocks,
			};
		}
		const text = source.mode === "signature" ? foldedSignatures.get(source.path) : source.text;
		if (text === undefined) throw new Error(`Signature folding returned no output for ${source.displayPath}.`);
		const label = JSON.stringify(source.displayPath);
		const newline = text.endsWith("\n") ? "" : "\n";
		return {
			displayPath: source.displayPath,
			selectionPath: source.selectionPath,
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
		(a, b) =>
			dirname(a.selectionPath).localeCompare(dirname(b.selectionPath)) ||
			a.selectionPath.localeCompare(b.selectionPath),
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
		if (!ctx.isProjectTrusted() || !existsSync(resolve(ctx.cwd, AGENTS_FILE_NAME))) return;
		const hasPreload = ctx.sessionManager
			.buildContextEntries()
			.some((entry) => entry.type === "custom_message" && entry.customType === CUSTOM_TYPE);
		if (hasPreload) return;

		ctx.ui.setStatus(CUSTOM_TYPE, "Preloading context...");

		try {
			const signal = AbortSignal.timeout(DEADLINE_MS);
			const result = await collectPreload(ctx.cwd, signal);
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
