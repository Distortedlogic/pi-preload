import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TextContent } from "@earendil-works/pi-ai";
import { collectPreload } from "../index.ts";

type PreloadResult = NonNullable<Awaited<ReturnType<typeof collectPreload>>>;

function textBlocks(blocks: PreloadResult["blocks"]): TextContent[] {
	return blocks.filter((block): block is TextContent => block.type === "text");
}

function preloadSnapshot(blocks: PreloadResult["blocks"]) {
	return `${blocks
		.map((block) =>
			block.type === "text" ? block.text : `![Preloaded image](data:${block.mimeType};base64,${block.data})`,
		)
		.join("\n\n")}\n`;
}

function fileBlock(path: string, content: string) {
	const newline = content.endsWith("\n") ? "" : "\n";
	const label = JSON.stringify(path);
	return `===== BEGIN FILE ${label} =====\n${content}${newline}===== END FILE ${label} =====`;
}

function fileBlockPaths(blocks: PreloadResult["blocks"]) {
	return textBlocks(blocks).flatMap((block) => {
		const match = /^===== BEGIN FILE (.+) =====/.exec(block.text);
		return match ? [JSON.parse(match[1]) as string] : [];
	});
}

test("collectPreload orders files by directory then path", async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-preload-unit-"));
	t.after(async () => rm(project, { recursive: true, force: true }));
	await mkdir(join(project, "nested"));
	await Promise.all([
		writeFile(join(project, "b.txt"), "b"),
		writeFile(join(project, "a.txt"), "a"),
		writeFile(join(project, "nested", "c.txt"), "c"),
	]);

	const result = await collectPreload({ cwd: project }, AbortSignal.timeout(5_000));

	assert.deepEqual(fileBlockPaths(result.blocks), ["a.txt", "b.txt", "nested/c.txt"]);
});

test("collectPreload excludes generated, ignored, and lock files from content", async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-preload-unit-"));
	t.after(async () => rm(project, { recursive: true, force: true }));
	await Promise.all([
		mkdir(join(project, ".git")),
		mkdir(join(project, ".pi")),
		mkdir(join(project, "ignored")),
		mkdir(join(project, "nested")),
	]);
	await Promise.all([
		writeFile(join(project, ".gitignore"), "ignored/\n"),
		writeFile(join(project, ".preloadignore"), ".git/\n.gitignore\n.toolrc\nexcluded.ts\nignored/\n"),
		writeFile(join(project, ".toolrc"), "hidden configuration"),
		writeFile(join(project, "excluded.ts"), "excluded"),
		writeFile(join(project, "source.ts"), "source"),
		writeFile(join(project, "package-lock.json"), "package lock"),
		writeFile(join(project, ".pi", "TREE.md"), "stale tree"),
		writeFile(join(project, ".git", "config"), "git metadata"),
		writeFile(join(project, "ignored", "secret.txt"), "ignored"),
		writeFile(join(project, "nested", "uv.lock"), "uv lock"),
	]);

	const result = await collectPreload({ cwd: project }, AbortSignal.timeout(5_000));

	assert.ok(result);
	assert.equal(result.count, 1);
	assert.deepEqual(fileBlockPaths(result.blocks), ["source.ts"]);
	assert.equal(await readFile(join(project, ".pi", "PRELOAD.md"), "utf8"), `${fileBlock("source.ts", "source")}\n`);
	assert.equal(await readFile(join(project, ".pi", "TREE.md"), "utf8"), "stale tree");
});

test("collectPreload rejects an explicitly selected non-image binary", async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-preload-unit-"));
	t.after(async () => rm(project, { recursive: true, force: true }));
	await writeFile(join(project, "invalid.txt"), Uint8Array.from([0xff]));

	await assert.rejects(
		collectPreload({ cwd: project }, AbortSignal.timeout(5_000)),
		/explicitly selected binary file/,
	);
});

test("collectPreload snapshots image blocks in returned order", async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-preload-unit-"));
	t.after(async () => rm(project, { recursive: true, force: true }));
	const image = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
		"base64",
	);
	await writeFile(join(project, "image.png"), image);

	const result = await collectPreload({ cwd: project }, AbortSignal.timeout(5_000));

	assert.ok(result);
	assert.equal(result.blocks.length, 2);
	assert.equal(result.blocks[0]?.type, "text");
	assert.equal(result.blocks[1]?.type, "image");
	const snapshot = await readFile(join(project, ".pi", "PRELOAD.md"), "utf8");
	assert.equal(snapshot, preloadSnapshot(result.blocks));
	assert.ok(snapshot.includes(`![Preloaded image](data:image/png;base64,${image.toString("base64")})`));
});

