import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import type { TextContent } from "@earendil-works/pi-ai";
import nunjucks from "nunjucks";
import { Value } from "typebox/value";
import type { Configuration } from "../agents.ts";
import { configurationSchema } from "../agents.ts";
import { type DioxusFacts, parseDioxusMetadata } from "../context/dioxus/facts.ts";
import { collectPreload } from "../src/index.ts";

type PreloadResult = NonNullable<Awaited<ReturnType<typeof collectPreload>>>;

function textBlocks(blocks: PreloadResult["blocks"]): TextContent[] {
	return blocks.filter((block): block is TextContent => block.type === "text");
}

async function createDynamicFixture(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), "pi-preload-unit-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const project = join(root, "project");
	const presetDirectory = join(root, "presets");
	const contextDirectory = join(root, "context");
	await Promise.all([mkdir(project), mkdir(presetDirectory), mkdir(contextDirectory)]);
	return { project, presetDirectory, contextDirectory };
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

async function writeContextSource(
	contextDirectory: string,
	name: string,
	options: { facts?: string; template: string; fragments?: Record<string, string> },
) {
	const sourceDirectory = join(contextDirectory, name);
	await mkdir(sourceDirectory, { recursive: true });
	const writes = [
		writeFile(join(sourceDirectory, "facts.ts"), options.facts ?? "export default async function () { return {}; }\n"),
		writeFile(join(sourceDirectory, "index.md.njk"), options.template),
	];
	for (const [path, content] of Object.entries(options.fragments ?? {})) {
		const target = join(sourceDirectory, path);
		await mkdir(dirname(target), { recursive: true });
		writes.push(writeFile(target, content));
	}
	await Promise.all(writes);
}

test("collectPreload validates configuration and applies merged selection rules", async (t) => {
	const { project, presetDirectory, contextDirectory } = await createDynamicFixture(t);
	const sourcePattern = join(project, "src", "included*.ts");
	const configuration: Configuration = {
		presets: ["common"],
		includes: [
			"local.txt",
			"ignored/**/*",
			"package-lock.json",
			"nested/uv.lock",
			"PRELOAD.md",
			"TREE.txt",
			"src/excluded.ts",
		],
		excludes: ["src/excluded.ts"],
	};
	assert.equal(Value.Check(configurationSchema, configuration), true);
	assert.equal(Value.Check(configurationSchema, { ...configuration, files: ["src/**/*.ts"] }), false);

	await Promise.all([mkdir(join(project, "src")), mkdir(join(project, "ignored")), mkdir(join(project, "nested"))]);
	await Promise.all([
		writeFile(join(presetDirectory, "common.yml"), JSON.stringify({ includes: [sourcePattern] })),
		writeFile(join(project, ".gitignore"), "ignored/\n"),
		writeFile(join(project, "local.txt"), "local"),
		writeFile(join(project, "src", "included.ts"), "included"),
		writeFile(join(project, "src", "excluded.ts"), "excluded"),
		writeFile(join(project, "ignored", "secret.txt"), "ignored"),
		writeFile(join(project, "package-lock.json"), "package lock"),
		writeFile(join(project, "nested", "uv.lock"), "uv lock"),
		writeFile(join(project, "PRELOAD.md"), "stale preload"),
		writeFile(join(project, "TREE.txt"), "stale tree"),
	]);

	const result = await collectPreload(
		project,
		AbortSignal.timeout(5_000),
		presetDirectory,
		contextDirectory,
		configuration,
	);

	assert.ok(result);
	assert.equal(result.count, 2);
	assert.deepEqual(fileBlockPaths(result.blocks), ["local.txt", "src/included.ts"]);
	const snapshot = await readFile(join(project, "PRELOAD.md"), "utf8");
	assert.ok(snapshot.includes(fileBlock("local.txt", "local")));
	assert.ok(snapshot.includes(fileBlock("src/included.ts", "included")));
	assert.ok(
		snapshot.indexOf('===== BEGIN FILE "local.txt" =====') <
			snapshot.indexOf('===== BEGIN FILE "src/included.ts" ====='),
	);
	assert.doesNotMatch(snapshot, /excluded|ignored|package lock|uv lock|stale preload/);
	assert.equal(await readFile(join(project, "TREE.txt"), "utf8"), "stale tree");

	await writeFile(join(presetDirectory, "invalid.yml"), JSON.stringify({ files: [42] }));
	await assert.rejects(
		collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, contextDirectory, {
			presets: ["invalid"],
		}),
		/invalid\.yml.*pi-preload/,
	);
});

test("collectPreload handles selected media and writes canonical output", async (t) => {
	await t.test("rejects a selected non-image binary", async (t) => {
		const project = await mkdtemp(join(tmpdir(), "pi-preload-unit-"));
		t.after(async () => rm(project, { recursive: true, force: true }));
		await writeFile(join(project, "invalid.txt"), Uint8Array.from([0xff]));

		await assert.rejects(
			collectPreload(project, AbortSignal.timeout(5_000), undefined, undefined, {
				includes: ["invalid.txt"],
			}),
			/explicitly selected binary file/,
		);
		await assert.rejects(readFile(join(project, "PRELOAD.md"), "utf8"), /ENOENT/);
	});

	await t.test("keeps image blocks in snapshot order", async (t) => {
		const project = await mkdtemp(join(tmpdir(), "pi-preload-unit-"));
		t.after(async () => rm(project, { recursive: true, force: true }));
		const image = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
			"base64",
		);
		await writeFile(join(project, "image.png"), image);

		const result = await collectPreload(project, AbortSignal.timeout(5_000), undefined, undefined, {
			includes: ["image.png"],
		});

		assert.ok(result);
		assert.deepEqual(
			result.blocks.map((block) => block.type),
			["text", "image"],
		);
		const snapshot = await readFile(join(project, "PRELOAD.md"), "utf8");
		assert.equal(textBlocks(result.blocks)[0]?.text, "File: image.png");
		assert.ok(snapshot.includes(`![Preloaded image](data:image/png;base64,${image.toString("base64")})`));
		assert.ok(Buffer.byteLength(snapshot) < 256 * 1024);
	});
});

test("collectPreload resolves selected contexts and reports scoped failures", async (t) => {
	await t.test("orders and deduplicates contexts before files", async (t) => {
		const { project, presetDirectory, contextDirectory } = await createDynamicFixture(t);
		await Promise.all([
			writeContextSource(contextDirectory, "first", {
				facts: 'export default async function () { return { name: "fixture", detail: "included" }; }\n',
				template: 'Project: {{ facts.name }}\r\n{% include "first/fragment.md" %}',
				fragments: { "fragment.md": "Fragment: {{ facts.detail }}\r\n" },
			}),
			writeContextSource(contextDirectory, "second", { template: "second\n" }),
			writeContextSource(contextDirectory, "not-applicable", {
				facts: "export default async function () { return undefined; }\n",
				template: "unused",
			}),
			writeFile(join(presetDirectory, "base.yml"), JSON.stringify({ contexts: ["first", "second"] })),
			writeFile(join(presetDirectory, "extra.yml"), JSON.stringify({ contexts: ["second"] })),
			writeFile(join(project, "selected.txt"), "selected"),
		]);

		const result = await collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, contextDirectory, {
			presets: ["base", "extra"],
			contexts: ["first", "not-applicable"],
			includes: ["selected.txt"],
		});

		assert.ok(result);
		assert.equal(result.count, 1);
		assert.equal(result.bytes, Buffer.byteLength("selected"));
		assert.deepEqual(
			textBlocks(result.blocks).map((block) => block.text),
			[
				"Context: first\n\nProject: fixture\nFragment: included\n",
				"Context: second\n\nsecond\n",
				fileBlock("selected.txt", "selected"),
			],
		);
		const snapshot = await readFile(join(project, "PRELOAD.md"), "utf8");
		assert.ok(snapshot.indexOf("Context: first") < snapshot.indexOf("Context: second"));
		assert.ok(snapshot.indexOf("Context: second") < snapshot.indexOf('===== BEGIN FILE "selected.txt" ====='));
		assert.ok(snapshot.includes("Fragment: included"));
	});

	await t.test("names execution and render failures", async (t) => {
		const { project, presetDirectory, contextDirectory } = await createDynamicFixture(t);
		await Promise.all([
			writeContextSource(contextDirectory, "execution-error", {
				facts: 'export default async function () { throw new Error("loader boom"); }\n',
				template: "unused",
			}),
			writeContextSource(contextDirectory, "render-error", {
				template: '{% include "render-error/missing.md" %}',
			}),
		]);

		await assert.rejects(
			collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, contextDirectory, {
				contexts: ["execution-error"],
			}),
			/Context source execution-error execution failed: loader boom/,
		);
		await assert.rejects(
			collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, contextDirectory, {
				contexts: ["render-error"],
			}),
			/Context source render-error render failed:/,
		);
	});
});

test("collectPreload applies dynamic block and combined context limits", async (t) => {
	await t.test("dynamic block limit", async (t) => {
		const { project, presetDirectory, contextDirectory } = await createDynamicFixture(t);
		const configuration: Configuration = { contexts: ["too-large"] };
		await writeContextSource(contextDirectory, "too-large", { template: "x".repeat(256 * 1024) });

		await assert.rejects(
			collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, contextDirectory, configuration),
			/block limit/,
		);
	});

	await t.test("combined dynamic and file limit", async (t) => {
		const { project, presetDirectory, contextDirectory } = await createDynamicFixture(t);
		const names = Array.from({ length: 9 }, (_, index) => `large-${index}`);
		await Promise.all(
			names.map((name) => writeContextSource(contextDirectory, name, { template: "x".repeat(255 * 1024) })),
		);
		const configuration: Configuration = { contexts: names, includes: ["selected.txt"] };
		await writeFile(join(project, "selected.txt"), "x".repeat(8 * 1024));

		await assert.rejects(
			collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, contextDirectory, configuration),
			/Context with headings is over/,
		);
	});
});

test("collectPreload follows nested project references and rejects cycles", async (t) => {
	await t.test("uses each nested root even when the parent ignores it", async (t) => {
		const root = await mkdtemp(join(tmpdir(), "pi-preload-unit-"));
		t.after(async () => rm(root, { recursive: true, force: true }));
		const parent = join(root, "parent");
		const middle = join(parent, "vendor", "middle");
		const inner = join(middle, "inner");
		const contextDirectory = join(root, "context");
		await Promise.all([
			mkdir(join(parent, ".git"), { recursive: true }),
			mkdir(join(inner, "docs"), { recursive: true }),
			mkdir(contextDirectory),
		]);
		await Promise.all([
			writeContextSource(contextDirectory, "probe", {
				facts: "export default async function ({ cwd }) { return { root: cwd }; }\n",
				template: "Root: {{ facts.root }}\n",
			}),
			writeFile(join(parent, ".gitignore"), "vendor/\n"),
			writeFile(join(parent, "parent.txt"), "parent"),
			writeFile(
				join(middle, "AGENTS.yml"),
				JSON.stringify({ "pi-preload": { extends: ["./inner"], includes: ["middle.txt"] } }),
			),
			writeFile(join(middle, "middle.txt"), "middle"),
			writeFile(
				join(inner, "AGENTS.yml"),
				JSON.stringify({ "pi-preload": { contexts: ["probe"], includes: ["docs/*.md"] } }),
			),
			writeFile(join(inner, "docs", "guide.md"), "guide"),
		]);

		const result = await collectPreload(parent, AbortSignal.timeout(5_000), undefined, contextDirectory, {
			extends: ["./vendor/middle"],
			includes: ["parent.txt"],
		});

		assert.ok(result);
		assert.equal(result.count, 3);
		assert.equal(textBlocks(result.blocks)[0]?.text, `Context: probe\n\nRoot: ${inner}\n`);
		assert.deepEqual(fileBlockPaths(result.blocks), [
			"vendor/middle/middle.txt",
			"parent.txt",
			"vendor/middle/inner/docs/guide.md",
		]);
		const snapshot = await readFile(join(parent, "PRELOAD.md"), "utf8");
		assert.ok(
			snapshot.indexOf("Context: probe") < snapshot.indexOf('===== BEGIN FILE "vendor/middle/middle.txt" ====='),
		);
		assert.ok(snapshot.includes(`Root: ${inner}`));
		assert.ok(snapshot.includes("middle"));
		assert.ok(snapshot.includes("guide"));
	});

	await t.test("rejects a project-reference cycle", async (t) => {
		const root = await mkdtemp(join(tmpdir(), "pi-preload-unit-"));
		t.after(async () => rm(root, { recursive: true, force: true }));
		const parent = join(root, "parent");
		const child = join(parent, "child");
		await mkdir(child, { recursive: true });
		await writeFile(join(child, "AGENTS.yml"), JSON.stringify({ "pi-preload": { extends: [".."] } }));

		await assert.rejects(
			collectPreload(parent, AbortSignal.timeout(5_000), undefined, undefined, { extends: ["./child"] }),
			/Circular context preload preset/,
		);
	});
});

test("collectPreload applies the total byte limit across project scopes", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-preload-unit-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const parent = join(root, "parent");
	const child = join(parent, "child");
	await mkdir(child, { recursive: true });
	const configuration: Configuration = { extends: ["./child"], includes: ["big-*.txt"] };
	const writes = [writeFile(join(child, "AGENTS.yml"), JSON.stringify({ "pi-preload": { includes: ["big-*.txt"] } }))];
	for (const directory of [parent, child]) {
		for (const name of ["big-1.txt", "big-2.txt", "big-3.txt", "big-4.txt", "big-5.txt", "big-6.txt"]) {
			writes.push(writeFile(join(directory, name), "x".repeat(200 * 1024)));
		}
	}
	await Promise.all(writes);

	await assert.rejects(
		collectPreload(parent, AbortSignal.timeout(5_000), undefined, undefined, configuration),
		/Selected files grew beyond/,
	);
});

test("parseDioxusMetadata selects one package and rejects an ambiguous workspace", () => {
	const workspaceRoot = join(tmpdir(), "dioxus-metadata");
	const metadata = {
		packages: [
			{
				id: "web-app",
				name: "web-app",
				manifest_path: join(workspaceRoot, "apps", "web", "Cargo.toml"),
				dependencies: [
					{ name: "dioxus", kind: null, features: ["fullstack", "web"] },
					{ name: "dioxus-router", kind: null },
				],
			},
			{
				id: "desktop-app",
				name: "desktop-app",
				manifest_path: join(workspaceRoot, "apps", "desktop", "Cargo.toml"),
				dependencies: [{ name: "dioxus", kind: null, features: ["desktop"] }],
			},
		],
		workspace_members: ["web-app", "desktop-app"],
		workspace_default_members: ["web-app", "desktop-app"],
		workspace_root: workspaceRoot,
	} satisfies Parameters<typeof parseDioxusMetadata>[0];

	assert.deepEqual(parseDioxusMetadata(metadata, join(workspaceRoot, "apps", "web", "src")), {
		platforms: ["web"],
		fullstack: true,
		router: true,
	});
	assert.deepEqual(parseDioxusMetadata(metadata, workspaceRoot), {
		platforms: [],
		fullstack: false,
		router: false,
	});
});

const dioxusEnvironment = new nunjucks.Environment(
	new nunjucks.FileSystemLoader(join(import.meta.dirname, "..", "context"), { noCache: true }),
	{ autoescape: false, throwOnUndefined: true },
);

function renderDioxusContext(facts: DioxusFacts) {
	return dioxusEnvironment.render("dioxus/index.md.njk", { facts });
}

test("Dioxus template composes router, full-stack, and platform fragments", async () => {
	const files = ["CORE.md", "ROUTER.md", "fullstack/10-FULLSTACK.md", "web/10-WEB.md"];
	const fragments = await Promise.all(
		files.map((file) => readFile(join(import.meta.dirname, "..", "context", "dioxus", file), "utf8")),
	);

	assert.equal(renderDioxusContext({ platforms: ["web"], fullstack: true, router: true }), fragments.join("\n"));
});
