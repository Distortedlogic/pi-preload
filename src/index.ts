import { writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { TextContent } from "@earendil-works/pi-ai";
import { type ExtensionAPI, formatSize } from "@earendil-works/pi-coding-agent";
import nunjucks from "nunjucks";
import { type PiPreloadConfiguration as Configuration, resolvePiPreloadSources } from "pi-agents-yaml";

const CUSTOM_TYPE = "pi-preload";
const MAX_BLOCK_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const PRELOAD_FILE = "PRELOAD.md";
const DEADLINE_MS = 30_000;
const DEFAULT_CONTEXT_DIRECTORY = fileURLToPath(new URL("../context/", import.meta.url));
const CONTEXT_FACTS_FILE = "facts.ts";
const CONTEXT_TEMPLATE_FILE = "index.md.njk";
function blockBytes(block: TextContent) {
	return Buffer.byteLength(block.text);
}

function serializePreloadBlocks(blocks: readonly TextContent[]) {
	return `${blocks.map((block) => block.text).join("\n\n")}\n`;
}

type ContextFactsLoader = (input: { cwd: string; signal: AbortSignal }) => Promise<Record<string, unknown> | undefined>;
type ContextSource = { name: string; facts: Record<string, unknown>; templatePath: string };
type ContextReference = { projectRoot: string; name: string };

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
		if (bytes > MAX_BLOCK_BYTES) {
			throw new Error(
				`Context source ${source.name} is ${formatSize(bytes)}; the block limit is ${formatSize(MAX_BLOCK_BYTES)}.`,
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
) {
	const resolution = await resolvePiPreloadSources({
		rootPath: cwd,
		...(configuration ? { rootValue: configuration } : {}),
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

	for (const block of contextBlocks) {
		const emittedBlockBytes = blockBytes(block);
		if (emittedBlockBytes > MAX_BLOCK_BYTES) {
			throw new Error(
				`Emitted context block is ${formatSize(emittedBlockBytes)}; the block limit is ${formatSize(MAX_BLOCK_BYTES)}.`,
			);
		}
	}
	const validatedPreloadSnapshot = serializePreloadBlocks(contextBlocks);
	const emittedContextBytes = Buffer.byteLength(validatedPreloadSnapshot);
	if (emittedContextBytes > MAX_TOTAL_BYTES) {
		throw new Error(`Generated context is over ${formatSize(MAX_TOTAL_BYTES)}.`);
	}

	signal.throwIfAborted();
	await writeFile(resolve(cwd, PRELOAD_FILE), validatedPreloadSnapshot, { encoding: "utf8", signal });
	return {
		blocks: contextBlocks,
		count: contextBlocks.length,
		contextBytes: emittedContextBytes,
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
			const result = await collectPreload(ctx.cwd, signal);
			pi.sendMessage({ customType: CUSTOM_TYPE, content: result.blocks, display: false }, { triggerTurn: false });
			ctx.ui.notify(
				`Context preloaded: ${result.count} generated sources — ${formatSize(result.contextBytes)}`,
				"info",
			);
		} finally {
			ctx.ui.setStatus(CUSTOM_TYPE, undefined);
		}
	});
}
