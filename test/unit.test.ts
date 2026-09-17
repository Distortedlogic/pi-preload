import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import type { TextContent } from "@earendil-works/pi-ai";
import nunjucks from "nunjucks";
import type { Configuration } from "../agents.ts";
import { type DioxusFacts, parseDioxusMetadata } from "../context/dioxus/facts.ts";
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

test("collectPreload merges named presets with local globs", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-preload-unit-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const project = join(root, "project");
	const presetDirectory = join(root, "presets");
	const sourcePattern = join(project, "src", "**", "*.ts");
	const excludedPattern = `!${join(project, "src", "excluded.ts")}`;
	await Promise.all([mkdir(join(project, "src"), { recursive: true }), mkdir(presetDirectory)]);
	const configuration: Configuration = { extends: ["common"], files: ["local.txt", excludedPattern] };
	await Promise.all([
		writeFile(join(presetDirectory, "common.yml"), JSON.stringify({ files: [sourcePattern] })),
		writeFile(join(project, "src", "included.ts"), "included"),
		writeFile(join(project, "src", "excluded.ts"), "excluded"),
		writeFile(join(project, "local.txt"), "local"),
	]);

	const result = await collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, undefined, configuration);

	assert.ok(result);
	assert.equal(result.count, 2);
	assert.deepEqual(fileBlockPaths(result.blocks), ["local.txt", "src/included.ts"]);
});

test("collectPreload excludes generated, ignored, and lock files from content", async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-preload-unit-"));
	t.after(async () => rm(project, { recursive: true, force: true }));
	await Promise.all([mkdir(join(project, ".git")), mkdir(join(project, "ignored")), mkdir(join(project, "nested"))]);
	const configuration: Configuration = { files: ["**/*", "PRELOAD.md", "TREE.txt", "!excluded.ts"] };
	await Promise.all([
		writeFile(join(project, ".gitignore"), "ignored/\n"),
		writeFile(join(project, ".toolrc"), "hidden configuration"),
		writeFile(join(project, "source.ts"), "source"),
		writeFile(join(project, "excluded.ts"), "excluded"),
		writeFile(join(project, "package-lock.json"), "package lock"),
		writeFile(join(project, "TREE.txt"), "stale tree"),
		writeFile(join(project, ".git", "config"), "git metadata"),
		writeFile(join(project, "ignored", "secret.txt"), "ignored"),
		writeFile(join(project, "nested", "uv.lock"), "uv lock"),
	]);

	const result = await collectPreload(project, AbortSignal.timeout(5_000), undefined, undefined, configuration);

	assert.ok(result);
	assert.equal(result.count, 1);
	assert.deepEqual(fileBlockPaths(result.blocks), ["source.ts"]);
	assert.equal(await readFile(join(project, "PRELOAD.md"), "utf8"), `${fileBlock("source.ts", "source")}\n`);
	assert.equal(await readFile(join(project, "TREE.txt"), "utf8"), "stale tree");
});

test("collectPreload validates presets with the shared configuration schema", async (t) => {
	const { project, presetDirectory, contextDirectory } = await createDynamicFixture(t);
	const configuration: Configuration = { extends: ["invalid"] };
	await writeFile(join(presetDirectory, "invalid.yml"), JSON.stringify({ files: [42] }));

	await assert.rejects(
		collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, contextDirectory, configuration),
		/invalid\.yml.*pi-preload/,
	);
});

test("collectPreload rejects an explicitly selected non-image binary", async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-preload-unit-"));
	t.after(async () => rm(project, { recursive: true, force: true }));
	const configuration: Configuration = { files: ["invalid.txt"] };
	await writeFile(join(project, "invalid.txt"), Uint8Array.from([0xff]));

	await assert.rejects(
		collectPreload(project, AbortSignal.timeout(5_000), undefined, undefined, configuration),
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
	const configuration: Configuration = { files: ["image.png"] };
	await writeFile(join(project, "image.png"), image);

	const result = await collectPreload(project, AbortSignal.timeout(5_000), undefined, undefined, configuration);

	assert.ok(result);
	assert.equal(result.blocks.length, 2);
	assert.equal(result.blocks[0]?.type, "text");
	assert.equal(result.blocks[1]?.type, "image");
	const snapshot = await readFile(join(project, "PRELOAD.md"), "utf8");
	assert.equal(snapshot, preloadSnapshot(result.blocks));
	assert.ok(snapshot.includes(`![Preloaded image](data:image/png;base64,${image.toString("base64")})`));
});

test("collectPreload inherits and deduplicates context names in order", async (t) => {
	const { project, presetDirectory, contextDirectory } = await createDynamicFixture(t);
	await Promise.all(
		["first", "second", "third"].map((name) => writeContextSource(contextDirectory, name, { template: `${name}\n` })),
	);
	const configuration: Configuration = { extends: ["base", "extra"], contexts: ["third", "first"] };
	await Promise.all([
		writeFile(join(presetDirectory, "base.yml"), JSON.stringify({ contexts: ["first", "second"] })),
		writeFile(join(presetDirectory, "extra.yml"), JSON.stringify({ contexts: ["second", "third"] })),
	]);

	const result = await collectPreload(
		project,
		AbortSignal.timeout(5_000),
		presetDirectory,
		contextDirectory,
		configuration,
	);

	assert.ok(result);
	assert.equal(result.count, 0);
	assert.deepEqual(
		textBlocks(result.blocks).map((block) => block.text),
		["Context: first\n\nfirst\n", "Context: second\n\nsecond\n", "Context: third\n\nthird\n"],
	);
});

test("collectPreload rejects unsafe context names", async (t) => {
	const { project, presetDirectory, contextDirectory } = await createDynamicFixture(t);
	for (const name of ["", "/absolute", "nested/source", "nested\\source", ".", ".."]) {
		const configuration: Configuration = { contexts: [name] };
		const preload = collectPreload(
			project,
			AbortSignal.timeout(5_000),
			presetDirectory,
			contextDirectory,
			configuration,
		);
		if (name === "") {
			await assert.rejects(preload);
		} else {
			await assert.rejects(preload, /Invalid context source name/);
		}
	}
});

test("collectPreload reports a missing context source", async (t) => {
	const { project, presetDirectory, contextDirectory } = await createDynamicFixture(t);
	const configuration: Configuration = { contexts: ["missing-source"] };

	await assert.rejects(
		collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, contextDirectory, configuration),
		/Context source missing-source import failed:/,
	);
});

test("collectPreload does not import an unselected context source", async (t) => {
	const { project, presetDirectory, contextDirectory } = await createDynamicFixture(t);
	const configuration: Configuration = { files: ["selected.txt"] };
	await Promise.all([
		writeContextSource(contextDirectory, "unselected", {
			facts: "export default (\n",
			template: "unused",
		}),
		writeFile(join(project, "selected.txt"), "selected"),
	]);

	const result = await collectPreload(
		project,
		AbortSignal.timeout(5_000),
		presetDirectory,
		contextDirectory,
		configuration,
	);

	assert.ok(result);
	assert.equal(result.count, 1);
	assert.equal(textBlocks(result.blocks)[0]?.text, fileBlock("selected.txt", "selected"));
});

test("collectPreload skips rendering when context facts are undefined", async (t) => {
	const { project, presetDirectory, contextDirectory } = await createDynamicFixture(t);
	const configuration: Configuration = { contexts: ["not-applicable"] };
	await Promise.all([
		writeContextSource(contextDirectory, "not-applicable", {
			facts: "export default async function () { return undefined; }\n",
			template: "{{ facts.missing }}",
		}),
	]);

	const result = await collectPreload(
		project,
		AbortSignal.timeout(5_000),
		presetDirectory,
		contextDirectory,
		configuration,
	);

	assert.ok(result);
	assert.equal(result.count, 0);
	assert.deepEqual(result.blocks, []);
});

test("collectPreload renders package context before files with one final newline", async (t) => {
	const { project, presetDirectory, contextDirectory } = await createDynamicFixture(t);
	const configuration: Configuration = { contexts: ["sample"], files: ["selected.txt"] };
	await Promise.all([
		writeContextSource(contextDirectory, "sample", {
			facts: 'export default async function () { return { name: "fixture", detail: "included" }; }\n',
			template: 'Project: {{ facts.name }}\r\n{% include "sample/fragment.md" %}',
			fragments: { "fragment.md": "Fragment: {{ facts.detail }}\r\n" },
		}),
		writeFile(join(project, "selected.txt"), "selected"),
	]);

	const result = await collectPreload(
		project,
		AbortSignal.timeout(5_000),
		presetDirectory,
		contextDirectory,
		configuration,
	);

	assert.ok(result);
	assert.equal(result.count, 1);
	assert.equal(result.bytes, Buffer.byteLength("selected"));
	const blocks = textBlocks(result.blocks);
	assert.equal(blocks.length, 2);
	assert.equal(blocks[0]?.text, "Context: sample\n\nProject: fixture\nFragment: included\n");
	assert.equal(blocks[1]?.text, fileBlock("selected.txt", "selected"));
	assert.equal(await readFile(join(project, "PRELOAD.md"), "utf8"), preloadSnapshot(result.blocks));
	assert.doesNotMatch(blocks[0]?.text ?? "", /\n\n$/);
});

test("collectPreload reports source-scoped context failures", async (t) => {
	const { project, presetDirectory, contextDirectory } = await createDynamicFixture(t);
	await Promise.all([
		writeContextSource(contextDirectory, "import-error", {
			facts: "export default (\n",
			template: "unused",
		}),
		writeContextSource(contextDirectory, "invalid-export", {
			facts: "export default 42;\n",
			template: "unused",
		}),
		writeContextSource(contextDirectory, "execution-error", {
			facts: 'export default async function () { throw new Error("loader boom"); }\n',
			template: "unused",
		}),
		writeContextSource(contextDirectory, "render-error", {
			template: '{% include "render-error/missing.md" %}',
		}),
	]);

	const cases: Array<[string, RegExp]> = [
		["import-error", /Context source import-error import failed:/],
		["invalid-export", /Context source invalid-export facts\.ts default export must be a function/],
		["execution-error", /Context source execution-error execution failed: loader boom/],
		["render-error", /Context source render-error render failed:/],
	];
	for (const [name, pattern] of cases) {
		const configuration: Configuration = { contexts: [name] };
		await assert.rejects(
			collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, contextDirectory, configuration),
			pattern,
		);
	}
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
		const names = ["large-0", "large-1", "large-2", "large-3"];
		await Promise.all(
			names.map((name) => writeContextSource(contextDirectory, name, { template: "x".repeat(255 * 1024) })),
		);
		const configuration: Configuration = { contexts: names, files: ["selected.txt"] };
		await writeFile(join(project, "selected.txt"), "x".repeat(8 * 1024));

		await assert.rejects(
			collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, contextDirectory, configuration),
			/Context with headings is over/,
		);
	});
});

test("collectPreload extends a child directory excluded by the parent .gitignore", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-preload-unit-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const parent = join(root, "parent");
	const child = join(parent, "child");
	await Promise.all([mkdir(join(parent, ".git"), { recursive: true }), mkdir(child, { recursive: true })]);
	const configuration: Configuration = { extends: ["./child"], files: ["**/*.txt"] };
	await Promise.all([
		writeFile(join(parent, ".gitignore"), "child/\n"),
		writeFile(join(parent, "parent.txt"), "parent"),
		writeFile(join(child, "AGENTS.yml"), JSON.stringify({ "pi-preload": { files: ["child.txt"] } })),
		writeFile(join(child, "child.txt"), "child"),
	]);

	const result = await collectPreload(parent, AbortSignal.timeout(5_000), undefined, undefined, configuration);

	assert.ok(result);
	assert.equal(result.count, 2);
	assert.deepEqual(fileBlockPaths(result.blocks), ["child/child.txt", "parent.txt"]);
	assert.equal(
		await readFile(join(parent, "PRELOAD.md"), "utf8"),
		`${fileBlock("child/child.txt", "child")}\n\n${fileBlock("parent.txt", "parent")}\n`,
	);
});

test("collectPreload resolves child patterns and context facts from the child root", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-preload-unit-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const parent = join(root, "parent");
	const child = join(parent, "vendor", "child");
	const contextDirectory = join(root, "context");
	await Promise.all([mkdir(join(child, "docs"), { recursive: true }), mkdir(contextDirectory)]);
	const configuration: Configuration = { extends: ["./vendor/child"] };
	await Promise.all([
		writeContextSource(contextDirectory, "probe", {
			facts: "export default async function ({ cwd }) { return { root: cwd }; }\n",
			template: "Root: {{ facts.root }}\n",
		}),
		writeFile(
			join(child, "AGENTS.yml"),
			JSON.stringify({ "pi-preload": { files: ["docs/*.md"], contexts: ["probe"] } }),
		),
		writeFile(join(child, "docs", "guide.md"), "guide"),
	]);

	const result = await collectPreload(parent, AbortSignal.timeout(5_000), undefined, contextDirectory, configuration);

	assert.ok(result);
	assert.equal(result.count, 1);
	assert.equal(textBlocks(result.blocks)[0]?.text, `Context: probe\n\nRoot: ${child}\n`);
	assert.deepEqual(fileBlockPaths(result.blocks), ["vendor/child/docs/guide.md"]);
});

test("collectPreload loads nested project references", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-preload-unit-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const parent = join(root, "parent");
	const middle = join(parent, "middle");
	const inner = join(middle, "inner");
	await mkdir(inner, { recursive: true });
	const configuration: Configuration = { extends: ["./middle"] };
	await Promise.all([
		writeFile(
			join(middle, "AGENTS.yml"),
			JSON.stringify({ "pi-preload": { extends: ["./inner"], files: ["middle.txt"] } }),
		),
		writeFile(join(inner, "AGENTS.yml"), JSON.stringify({ "pi-preload": { files: ["deep.txt"] } })),
		writeFile(join(middle, "middle.txt"), "middle"),
		writeFile(join(inner, "deep.txt"), "deep"),
	]);

	const result = await collectPreload(parent, AbortSignal.timeout(5_000), undefined, undefined, configuration);

	assert.ok(result);
	assert.equal(result.count, 2);
	assert.deepEqual(fileBlockPaths(result.blocks), ["middle/inner/deep.txt", "middle/middle.txt"]);
});

test("collectPreload rejects circular project references", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-preload-unit-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const parent = join(root, "parent");
	const child = join(parent, "child");
	await mkdir(child, { recursive: true });
	const configuration: Configuration = { extends: ["./child"] };
	await writeFile(join(child, "AGENTS.yml"), JSON.stringify({ "pi-preload": { extends: [".."] } }));

	await assert.rejects(
		collectPreload(parent, AbortSignal.timeout(5_000), undefined, undefined, configuration),
		/Circular context preload preset/,
	);
});

test("collectPreload applies the total byte limit across project scopes", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-preload-unit-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const parent = join(root, "parent");
	const child = join(parent, "child");
	await mkdir(child, { recursive: true });
	const configuration: Configuration = { extends: ["./child"], files: ["big-*.txt"] };
	const writes = [writeFile(join(child, "AGENTS.yml"), JSON.stringify({ "pi-preload": { files: ["big-*.txt"] } }))];
	for (const directory of [parent, child]) {
		for (const name of ["big-1.txt", "big-2.txt", "big-3.txt"]) {
			writes.push(writeFile(join(directory, name), "x".repeat(200 * 1024)));
		}
	}
	await Promise.all(writes);

	await assert.rejects(
		collectPreload(parent, AbortSignal.timeout(5_000), undefined, undefined, configuration),
		/Selected files grew beyond/,
	);
});

test("parseDioxusMetadata handles deterministic workspace scenarios", () => {
	const workspaceRoot = join(tmpdir(), "dioxus-metadata");
	const scenarios = [
		{
			name: "deepest containing package",
			cwd: join(workspaceRoot, "apps", "root", "nested", "src"),
			metadata: {
				packages: [
					{
						id: "root-app",
						name: "root-app",
						manifest_path: join(workspaceRoot, "apps", "root", "Cargo.toml"),
						dependencies: [
							{ name: "dioxus", kind: null, features: ["fullstack", "web"] },
							{ name: "dioxus-router", kind: null },
						],
					},
					{
						id: "nested-app",
						name: "nested-app",
						manifest_path: join(workspaceRoot, "apps", "root", "nested", "Cargo.toml"),
						dependencies: [{ name: "dioxus", kind: null, features: ["desktop"] }],
						features: { inactive: ["dioxus/mobile"] },
					},
				],
				workspace_members: ["root-app", "nested-app"],
				workspace_default_members: ["root-app"],
				workspace_root: workspaceRoot,
			},
			expected: { platforms: ["desktop"], fullstack: false, router: false },
		},
		{
			name: "only Dioxus default member",
			cwd: join(workspaceRoot, "tools"),
			metadata: {
				packages: [
					{
						id: "web-app",
						name: "web-app",
						manifest_path: join(workspaceRoot, "apps", "web", "Cargo.toml"),
						dependencies: [{ name: "dioxus", kind: null, features: ["web"] }],
					},
					{
						id: "mobile-app",
						name: "mobile-app",
						manifest_path: join(workspaceRoot, "apps", "mobile", "Cargo.toml"),
						dependencies: [{ name: "dioxus", kind: null, features: ["mobile"] }],
					},
				],
				workspace_members: ["web-app", "mobile-app"],
				workspace_default_members: ["mobile-app"],
				workspace_root: workspaceRoot,
			},
			expected: { platforms: ["mobile"], fullstack: false, router: false },
		},
		{
			name: "only Dioxus workspace package",
			cwd: join(workspaceRoot, "tools"),
			metadata: {
				packages: [
					{
						id: "server-app",
						name: "server-app",
						manifest_path: join(workspaceRoot, "apps", "server", "Cargo.toml"),
						dependencies: [{ name: "dioxus", kind: null, features: ["server"] }],
					},
					{
						id: "utility",
						name: "utility",
						manifest_path: join(workspaceRoot, "crates", "utility", "Cargo.toml"),
						dependencies: [],
					},
				],
				workspace_members: ["server-app", "utility"],
				workspace_default_members: [],
				workspace_root: workspaceRoot,
			},
			expected: { platforms: ["server"], fullstack: false, router: false },
		},
		{
			name: "ambiguous workspace",
			cwd: workspaceRoot,
			metadata: {
				packages: [
					{
						id: "web-app",
						name: "web-app",
						manifest_path: join(workspaceRoot, "apps", "web", "Cargo.toml"),
						dependencies: [
							{ name: "dioxus", kind: null, features: ["web"] },
							{ name: "dioxus-router", kind: null },
						],
					},
					{
						id: "desktop-app",
						name: "desktop-app",
						manifest_path: join(workspaceRoot, "apps", "desktop", "Cargo.toml"),
						dependencies: [{ name: "dioxus", kind: null, features: ["desktop", "fullstack"] }],
					},
				],
				workspace_members: ["web-app", "desktop-app"],
				workspace_default_members: ["web-app", "desktop-app"],
				workspace_root: workspaceRoot,
			},
			expected: { platforms: [], fullstack: false, router: false },
		},
		{
			name: "direct and default-reachable features",
			cwd: join(workspaceRoot, "app", "src"),
			metadata: {
				packages: [
					{
						id: "app",
						name: "app",
						manifest_path: join(workspaceRoot, "app", "Cargo.toml"),
						dependencies: [
							{ name: "dioxus", rename: "dx", kind: null, features: ["web"] },
							{ name: "dioxus", kind: "dev", features: ["native"] },
							{ name: "dioxus-router", kind: "dev" },
						],
						features: {
							default: ["ui"],
							ui: ["dx?/server", "nested"],
							nested: ["cycle", "dx/fullstack"],
							cycle: ["ui"],
							inactive: ["dx/desktop", "dx/mobile", "dx/native", "dx/router"],
						},
					},
				],
				workspace_members: ["app"],
				workspace_default_members: ["app"],
				workspace_root: workspaceRoot,
			},
			expected: { platforms: ["server", "web"], fullstack: true, router: false },
		},
		{
			name: "direct router dependency",
			cwd: join(workspaceRoot, "router-app"),
			metadata: {
				packages: [
					{
						id: "router-app",
						name: "router-app",
						manifest_path: join(workspaceRoot, "router-app", "Cargo.toml"),
						dependencies: [
							{ name: "dioxus", kind: null },
							{ name: "dioxus-router", kind: null },
						],
					},
				],
				workspace_members: ["router-app"],
				workspace_default_members: ["router-app"],
				workspace_root: workspaceRoot,
			},
			expected: { platforms: [], fullstack: false, router: true },
		},
		{
			name: "no workspace Dioxus dependency",
			cwd: join(workspaceRoot, "app"),
			metadata: {
				packages: [
					{
						id: "app",
						name: "app",
						manifest_path: join(workspaceRoot, "app", "Cargo.toml"),
						dependencies: [{ name: "dioxus-router", kind: null }],
					},
					{
						id: "outside",
						name: "outside",
						manifest_path: join(workspaceRoot, "outside", "Cargo.toml"),
						dependencies: [{ name: "dioxus", kind: null, features: ["web"] }],
					},
				],
				workspace_members: ["app"],
				workspace_default_members: ["app"],
				workspace_root: workspaceRoot,
			},
			expected: undefined,
		},
	] satisfies Array<{
		name: string;
		cwd: string;
		metadata: Parameters<typeof parseDioxusMetadata>[0];
		expected: DioxusFacts | undefined;
	}>;

	for (const scenario of scenarios) {
		assert.deepEqual(parseDioxusMetadata(scenario.metadata, scenario.cwd), scenario.expected, scenario.name);
	}
});

const dioxusEnvironment = new nunjucks.Environment(
	new nunjucks.FileSystemLoader(join(import.meta.dirname, "..", "context"), { noCache: true }),
	{ autoescape: false, throwOnUndefined: true },
);
const dioxusBaseFacts: DioxusFacts = {
	platforms: [],
	fullstack: false,
	router: false,
};
const dioxusContextScenarios = {
	coreOnly: dioxusBaseFacts,
	router: { ...dioxusBaseFacts, router: true },
	fullstackWebServer: {
		...dioxusBaseFacts,
		platforms: ["server", "web"],
		fullstack: true,
	},
	unrelatedWorkspace: dioxusBaseFacts,
} satisfies Record<string, DioxusFacts>;
const dioxusContextByteBudgets = {
	coreOnly: 1200,
	router: 1400,
	fullstackWebServer: 3000,
	unrelatedWorkspace: 1200,
} satisfies Record<keyof typeof dioxusContextScenarios, number>;

function renderDioxusContext(facts: DioxusFacts) {
	return dioxusEnvironment.render("dioxus/index.md.njk", { facts });
}

test("keeps representative Dioxus contexts within byte budgets", () => {
	const renderedBytes = Object.fromEntries(
		Object.entries(dioxusContextScenarios).map(([name, facts]) => [
			name,
			Buffer.byteLength(renderDioxusContext(facts)),
		]),
	) as Record<keyof typeof dioxusContextScenarios, number>;
	for (const name of Object.keys(dioxusContextScenarios) as Array<keyof typeof dioxusContextScenarios>) {
		assert.ok(
			renderedBytes[name] <= dioxusContextByteBudgets[name],
			`${name} exceeds its ${dioxusContextByteBudgets[name]} byte limit`,
		);
	}
});

test("Dioxus template follows every inclusion-matrix condition", async () => {
	const groups: Array<{ facts: Partial<DioxusFacts>; file: string }> = [
		{ facts: { router: true }, file: "ROUTER.md" },
		{ facts: { fullstack: true }, file: "fullstack/10-FULLSTACK.md" },
		{ facts: { platforms: ["server"] }, file: "server/10-SERVER.md" },
		{ facts: { platforms: ["web"] }, file: "web/10-WEB.md" },
		{ facts: { platforms: ["desktop"] }, file: "desktop/10-DESKTOP.md" },
		{ facts: { platforms: ["mobile"] }, file: "mobile/10-MOBILE.md" },
	];
	const files = ["CORE.md", ...groups.map((group) => group.file)];
	const fragments = new Map(
		await Promise.all(
			files.map(
				async (file) =>
					[file, await readFile(join(import.meta.dirname, "..", "context", "dioxus", file), "utf8")] as const,
			),
		),
	);
	const core = fragments.get("CORE.md");
	assert.ok(core);
	const render = (facts: Partial<DioxusFacts> = {}) => renderDioxusContext({ ...dioxusBaseFacts, ...facts });
	const specialistContent =
		/Initial Setup|dx serve|\[features\]|LaunchBuilder|use_store|#\[store\]|SetCookie|TypedHeader<Cookie>|ServerEvents|Websocket|FileStream|ByteStream|MultipartFormData|service[- ]worker|CustomPaintSource|use_wgpu|DioxusDocument|manganis::ffi|widget_extensions|ActivityAttributes|Gradle|extern "Swift"/i;

	assert.equal(render(), core);
	assert.doesNotMatch(render(), specialistContent);
	for (const group of groups) {
		const fragment = fragments.get(group.file);
		assert.ok(fragment);
		const rendered = render(group.facts);
		assert.equal(rendered, `${core}\n${fragment}`);
		assert.doesNotMatch(rendered, specialistContent);
	}

	const allFragments = groups.map((group) => {
		const fragment = fragments.get(group.file);
		assert.ok(fragment);
		return fragment;
	});
	const allCapabilities = render({
		platforms: ["server", "web", "desktop", "mobile"],
		fullstack: true,
		router: true,
	});
	assert.equal(allCapabilities, [core, ...allFragments].join("\n"));
	assert.doesNotMatch(allCapabilities, specialistContent);
});
