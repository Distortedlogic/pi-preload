import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SignatureLanguage } from "./languages.ts";

export const GRIT_GLOBAL_DIRECTORY = resolve(getAgentDir(), ".cache", "pi-preload", "grit");

process.env.GRIT_GLOBAL_DIR = GRIT_GLOBAL_DIRECTORY;

type QueryBuilderConstructor = typeof import("@getgrit/gritql")["QueryBuilder"];

let QueryBuilder: QueryBuilderConstructor | undefined;
let initializationError: unknown;

try {
	const grit = await import("@getgrit/gritql");
	const warmup = new grit.QueryBuilder("language js\n\n`console.log($_)`");
	await warmup.applyToFile({ path: "pi-preload-warmup.js", content: "console.log('warmup');\n" });
	QueryBuilder = grit.QueryBuilder;
} catch (error) {
	initializationError = error;
}

export function requireQueryBuilder(): QueryBuilderConstructor {
	if (QueryBuilder) return QueryBuilder;
	const detail = initializationError instanceof Error ? initializationError.message : String(initializationError);
	throw new Error(
		`Grit could not initialize its standard library in ${GRIT_GLOBAL_DIRECTORY}. The first signature preload requires network access to fetch it: ${detail}`,
		{ cause: initializationError },
	);
}

export class SignaturePatternCompileError extends Error {
	constructor(language: SignatureLanguage["language"], patternFile: string, cause: unknown) {
		super(`Could not compile the ${language} signature pattern ${patternFile}.`, { cause });
		this.name = "SignaturePatternCompileError";
	}
}

export class SignatureFileFoldError extends Error {
	constructor(path: string, cause: unknown) {
		const detail = cause instanceof Error ? cause.message : String(cause);
		super(`Could not fold callable bodies in ${path}: ${detail}`, { cause });
		this.name = "SignatureFileFoldError";
	}
}

export interface SignatureFile {
	path: string;
	content: string;
	registry: SignatureLanguage;
}

export async function foldSignatures(
	files: readonly SignatureFile[],
	signal?: AbortSignal,
): Promise<Map<string, string>> {
	signal?.throwIfAborted();
	const Builder = requireQueryBuilder();
	const builders = new Map<SignatureLanguage["language"], InstanceType<QueryBuilderConstructor>>();
	const folded = new Map<string, string>();

	for (const file of files) {
		signal?.throwIfAborted();
		let builder = builders.get(file.registry.language);
		if (!builder) {
			const patternSource = await readFile(file.registry.patternFile, { encoding: "utf8", signal });
			try {
				builder = new Builder(patternSource);
			} catch (error) {
				throw new SignaturePatternCompileError(file.registry.language, file.registry.patternFile, error);
			}
			builders.set(file.registry.language, builder);
		}
		let content: string;
		try {
			const result = await builder.applyToFile({ path: file.path, content: file.content });
			content = result?.content ?? file.content;
		} catch (error) {
			throw new SignatureFileFoldError(file.path, error);
		}
		signal?.throwIfAborted();
		folded.set(file.path, content);
	}

	return folded;
}
