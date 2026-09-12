import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectPreload } from "../index.ts";

test("collectPreload reads cwd, parent, and absolute globs", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-context-preload-unit-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const project = join(root, "project");
	const absoluteFile = join(root, "absolute.txt");
	await mkdir(project);
	await Promise.all([
		writeFile(join(project, "inside.txt"), "inside"),
		writeFile(join(root, "parent.txt"), "parent"),
		writeFile(absoluteFile, "absolute"),
		writeFile(
			join(project, "CONTEXT_PRELOAD.yml"),
			JSON.stringify({ files: ["inside.txt", "../parent.txt", absoluteFile] }),
		),
	]);

	const result = await collectPreload(project, AbortSignal.timeout(5_000));

	assert.ok(result);
	assert.equal(result.count, 3);
	assert.equal(result.bytes, Buffer.byteLength("insideparentabsolute"));
	const text = result.blocks.map((block) => block.text);
	assert.ok(text.includes("File: inside.txt\n\ninside"));
	assert.ok(text.includes("File: ../parent.txt\n\nparent"));
	assert.ok(text.includes(`File: ${absoluteFile}\n\nabsolute`));
});

test("collectPreload merges named presets with local globs", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-context-preload-unit-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const project = join(root, "project");
	const presetDirectory = join(root, "presets");
	const sourcePattern = join(project, "src", "**", "*.ts");
	const excludedPattern = `!${join(project, "src", "excluded.ts")}`;
	await Promise.all([mkdir(join(project, "src"), { recursive: true }), mkdir(presetDirectory)]);
	await Promise.all([
		writeFile(
			join(project, "CONTEXT_PRELOAD.yml"),
			JSON.stringify({ extends: ["common"], files: ["local.txt", excludedPattern] }),
		),
		writeFile(join(presetDirectory, "common.yml"), JSON.stringify({ files: [sourcePattern] })),
		writeFile(join(project, "src", "included.ts"), "included"),
		writeFile(join(project, "src", "excluded.ts"), "excluded"),
		writeFile(join(project, "local.txt"), "local"),
	]);

	const result = await collectPreload(project, AbortSignal.timeout(5_000), presetDirectory);

	assert.ok(result);
	assert.equal(result.count, 2);
	const paths = result.blocks.map((block) => block.text.slice(6, block.text.indexOf("\n\n")));
	assert.deepEqual(paths, ["local.txt", join(project, "src", "included.ts")]);
});

test("collectPreload excludes lock files from broad globs", async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-context-preload-unit-"));
	t.after(async () => rm(project, { recursive: true, force: true }));
	await mkdir(join(project, "nested"));
	await Promise.all([
		writeFile(join(project, "CONTEXT_PRELOAD.yml"), JSON.stringify({ files: ["**/*"] })),
		writeFile(join(project, "source.ts"), "source"),
		writeFile(join(project, "package-lock.json"), "package lock"),
		writeFile(join(project, "nested", "uv.lock"), "uv lock"),
	]);

	const result = await collectPreload(project, AbortSignal.timeout(5_000));

	assert.ok(result);
	assert.equal(result.count, 2);
	const paths = result.blocks.map((block) => block.text.slice(6, block.text.indexOf("\n\n")));
	assert.deepEqual(paths, ["CONTEXT_PRELOAD.yml", "source.ts"]);
});

test("collectPreload rejects an invalid glob list", async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-context-preload-unit-"));
	t.after(async () => rm(project, { recursive: true, force: true }));
	await writeFile(join(project, "CONTEXT_PRELOAD.yml"), JSON.stringify({ files: [42] }));

	await assert.rejects(collectPreload(project, AbortSignal.timeout(5_000)));
});

test("collectPreload rejects invalid UTF-8", async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-context-preload-unit-"));
	t.after(async () => rm(project, { recursive: true, force: true }));
	await Promise.all([
		writeFile(join(project, "CONTEXT_PRELOAD.yml"), JSON.stringify({ files: ["invalid.txt"] })),
		writeFile(join(project, "invalid.txt"), Uint8Array.from([0xff])),
	]);

	await assert.rejects(collectPreload(project, AbortSignal.timeout(5_000)), /not valid UTF-8 text/);
});
