import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { type ExtensionAPI, formatSize } from "@earendil-works/pi-coding-agent";
import { fileTypeFromBuffer } from "file-type";
import { globby } from "globby";
import { isBinaryFile } from "isbinaryfile";
import pMap from "p-map";

const CUSTOM_TYPE = "pi-preload";
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
const PRELOAD_IGNORE_FILE = ".preloadignore";
const CONCURRENCY = 8;
const DEADLINE_MS = 30_000;
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

export async function collectPreload(cwd: string, signal: AbortSignal) {
	signal.throwIfAborted();
	const candidates = await globby("**/*", {
		cwd,
		gitignore: true,
		ignoreFiles: [PRELOAD_IGNORE_FILE],
		ignore: [PRELOAD_IGNORE_FILE, PRELOAD_FILE, TREE_FILE, ...LOCK_FILE_GLOBS],
		onlyFiles: true,
		followSymbolicLinks: false,
		unique: true,
		objectMode: true,
		stats: true,
	});
	signal.throwIfAborted();
	const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
	const selectedFiles = await pMap(
		candidates,
		async (file) => {
			const path = resolve(cwd, file.path);
			const bytes = await readFile(path, { signal });
			const binary = await isBinaryFile(bytes);
			if (!file.dirent.isFile()) throw new Error(`Not a regular file: ${file.path}`);
			const fileBytes = file.stats?.size;
			if (fileBytes === undefined) throw new Error(`Could not read file metadata: ${file.path}`);
			if (fileBytes > MAX_FILE_BYTES) {
				throw new Error(`${file.path} is ${formatSize(fileBytes)}; the file limit is ${formatSize(MAX_FILE_BYTES)}.`);
			}
			if (bytes.length > MAX_FILE_BYTES) {
				throw new Error(`${file.path} grew beyond ${formatSize(MAX_FILE_BYTES)}.`);
			}

			let blocks: PreloadBlock[];
			if (binary) {
				const fileType = await fileTypeFromBuffer(bytes);
				if (!fileType?.mime.startsWith("image/")) {
					throw new Error(`${file.path} is an explicitly selected binary file, but Pi context supports only images.`);
				}
				blocks = [
					{ type: "text", text: `File: ${file.path}` },
					{ type: "image", data: bytes.toString("base64"), mimeType: fileType.mime },
				];
			} else {
				let text: string;
				try {
					text = decoder.decode(bytes);
				} catch {
					throw new Error(`${file.path} is not valid UTF-8 text.`);
				}
				const label = JSON.stringify(file.path);
				const newline = text.endsWith("\n") ? "" : "\n";
				blocks = [
					{
						type: "text",
						text: `===== BEGIN FILE ${label} =====\n${text}${newline}===== END FILE ${label} =====`,
					},
				];
			}
			return { file, bytes: bytes.length, blocks };
		},
		{ concurrency: CONCURRENCY, signal },
	);
	const files = selectedFiles.filter((file) => file !== undefined);
	signal.throwIfAborted();
	if (files.length > MAX_FILES) throw new Error(`Preload has more than ${MAX_FILES} files.`);
	files.sort(
		(a, b) => dirname(a.file.path).localeCompare(dirname(b.file.path)) || a.file.path.localeCompare(b.file.path),
	);
	const selectedFileBytes = files.reduce((total, file) => total + file.bytes, 0);
	if (selectedFileBytes > MAX_TOTAL_BYTES) {
		throw new Error(`Selected files grew beyond ${formatSize(MAX_TOTAL_BYTES)}.`);
	}
	const blocks: PreloadBlock[] = files.flatMap((file) => file.blocks);

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
			const result = await collectPreload(ctx.cwd, signal);
			if (!result) return;

			pi.sendMessage({ customType: CUSTOM_TYPE, content: result.blocks, display: false }, { triggerTurn: false });
			ctx.ui.notify(`Context preloaded: ${result.count} files — ${formatSize(result.bytes)}`, "info");
		} finally {
			ctx.ui.setStatus(CUSTOM_TYPE, undefined);
		}
	});
}
