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
		writeFile(join(project, "CONTEXT_PRELOAD.yml"), JSON.stringify(["inside.txt", "../parent.txt", absoluteFile])),
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

test("collectPreload rejects an invalid glob list", async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-context-preload-unit-"));
	t.after(async () => rm(project, { recursive: true, force: true }));
	await writeFile(join(project, "CONTEXT_PRELOAD.yml"), JSON.stringify([42]));

	await assert.rejects(collectPreload(project, AbortSignal.timeout(5_000)));
});

test("collectPreload rejects invalid UTF-8", async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-context-preload-unit-"));
	t.after(async () => rm(project, { recursive: true, force: true }));
	await Promise.all([
		writeFile(join(project, "CONTEXT_PRELOAD.yml"), JSON.stringify(["invalid.txt"])),
		writeFile(join(project, "invalid.txt"), Uint8Array.from([0xff])),
	]);

	await assert.rejects(collectPreload(project, AbortSignal.timeout(5_000)), /not valid UTF-8 text/);
});
