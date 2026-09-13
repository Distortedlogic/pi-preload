import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import type { TextContent } from "@earendil-works/pi-ai";
import nunjucks from "nunjucks";
import { type DioxusFacts, parseDioxusMetadata } from "../context/dioxus/facts.ts";
import { collectPreload } from "../index.ts";

type PreloadResult = NonNullable<Awaited<ReturnType<typeof collectPreload>>>;

function textBlocks(blocks: PreloadResult["blocks"]): TextContent[] {
	return blocks.filter((block): block is TextContent => block.type === "text");
}

async function createDynamicFixture(t: TestContext) {
	const root = await mkdtemp(join(tmpdir(), "pi-context-preload-unit-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const project = join(root, "project");
	const presetDirectory = join(root, "presets");
	const contextDirectory = join(root, "context");
	await Promise.all([mkdir(project), mkdir(presetDirectory), mkdir(contextDirectory)]);
	return { project, presetDirectory, contextDirectory };
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
	const text = textBlocks(result.blocks).map((block) => block.text);
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
	const paths = textBlocks(result.blocks.slice(0, -1)).map((block) => block.text.slice(6, block.text.indexOf("\n\n")));
	assert.deepEqual(paths, ["local.txt", join(project, "src", "included.ts")]);
});

test("collectPreload excludes ignored and lock files from content and tree", async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-context-preload-unit-"));
	t.after(async () => rm(project, { recursive: true, force: true }));
	await Promise.all([mkdir(join(project, ".git")), mkdir(join(project, "ignored")), mkdir(join(project, "nested"))]);
	await Promise.all([
		writeFile(join(project, "CONTEXT_PRELOAD.yml"), JSON.stringify({ files: ["**/*", "!excluded.ts"] })),
		writeFile(join(project, ".gitignore"), "ignored/\n"),
		writeFile(join(project, ".toolrc"), "hidden configuration"),
		writeFile(join(project, "source.ts"), "source"),
		writeFile(join(project, "excluded.ts"), "excluded"),
		writeFile(join(project, "package-lock.json"), "package lock"),
		writeFile(join(project, ".git", "config"), "git metadata"),
		writeFile(join(project, "ignored", "secret.txt"), "ignored"),
		writeFile(join(project, "nested", "uv.lock"), "uv lock"),
	]);

	const result = await collectPreload(project, AbortSignal.timeout(5_000));

	assert.ok(result);
	assert.equal(result.count, 2);
	const paths = textBlocks(result.blocks.slice(0, -1)).map((block) => block.text.slice(6, block.text.indexOf("\n\n")));
	assert.deepEqual(paths, ["CONTEXT_PRELOAD.yml", "source.ts"]);
	const tree = await readFile(join(project, "TREE.txt"), "utf8");
	const treeBlock = textBlocks(result.blocks.slice(-1))[0];
	assert.equal(treeBlock?.text, `File: TREE.txt\n\n${tree}`);
	assert.match(tree, /\.gitignore/);
	assert.match(tree, /\.toolrc/);
	assert.match(tree, /source\.ts/);
	assert.doesNotMatch(
		tree,
		/CONTEXT_PRELOAD\.yml|TREE\.txt|excluded\.ts|package-lock\.json|uv\.lock|secret\.txt|\.git\/config/,
	);
});

test("collectPreload rejects an invalid glob list", async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-context-preload-unit-"));
	t.after(async () => rm(project, { recursive: true, force: true }));
	await writeFile(join(project, "CONTEXT_PRELOAD.yml"), JSON.stringify({ files: [42] }));

	await assert.rejects(collectPreload(project, AbortSignal.timeout(5_000)));
});

test("collectPreload rejects an explicitly selected non-image binary", async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-context-preload-unit-"));
	t.after(async () => rm(project, { recursive: true, force: true }));
	await Promise.all([
		writeFile(join(project, "CONTEXT_PRELOAD.yml"), JSON.stringify({ files: ["invalid.txt"] })),
		writeFile(join(project, "invalid.txt"), Uint8Array.from([0xff])),
	]);

	await assert.rejects(collectPreload(project, AbortSignal.timeout(5_000)), /explicitly selected binary file/);
});

test("collectPreload inherits and deduplicates context names in order", async (t) => {
	const { project, presetDirectory, contextDirectory } = await createDynamicFixture(t);
	await Promise.all(
		["first", "second", "third"].map((name) => writeContextSource(contextDirectory, name, { template: `${name}\n` })),
	);
	await Promise.all([
		writeFile(
			join(project, "CONTEXT_PRELOAD.yml"),
			JSON.stringify({ extends: ["base", "extra"], contexts: ["third", "first"] }),
		),
		writeFile(join(presetDirectory, "base.yml"), JSON.stringify({ contexts: ["first", "second"] })),
		writeFile(join(presetDirectory, "extra.yml"), JSON.stringify({ contexts: ["second", "third"] })),
	]);

	const result = await collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, contextDirectory);

	assert.ok(result);
	assert.equal(result.count, 0);
	assert.deepEqual(
		textBlocks(result.blocks.slice(0, -1)).map((block) => block.text),
		["Context: first\n\nfirst\n", "Context: second\n\nsecond\n", "Context: third\n\nthird\n"],
	);
});

test("collectPreload rejects unsafe context names", async (t) => {
	const { project, presetDirectory, contextDirectory } = await createDynamicFixture(t);
	for (const name of ["", "/absolute", "nested/source", "nested\\source", ".", ".."]) {
		await writeFile(join(project, "CONTEXT_PRELOAD.yml"), JSON.stringify({ contexts: [name] }));
		const preload = collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, contextDirectory);
		if (name === "") {
			await assert.rejects(preload);
		} else {
			await assert.rejects(preload, /Invalid context source name/);
		}
	}
});

test("collectPreload requires regular convention entry files", async (t) => {
	const { project, presetDirectory, contextDirectory } = await createDynamicFixture(t);
	const missingFacts = join(contextDirectory, "missing-facts");
	const missingTemplate = join(contextDirectory, "missing-template");
	const nonRegular = join(contextDirectory, "non-regular");
	await Promise.all([mkdir(missingFacts), mkdir(missingTemplate), mkdir(nonRegular)]);
	await Promise.all([
		writeFile(join(missingFacts, "index.md.njk"), "unused"),
		writeFile(join(missingTemplate, "facts.ts"), "export default async function () { return {}; }\n"),
		mkdir(join(nonRegular, "facts.ts")),
		writeFile(join(nonRegular, "index.md.njk"), "unused"),
	]);

	for (const name of ["missing-facts", "missing-template", "non-regular"]) {
		await writeFile(join(project, "CONTEXT_PRELOAD.yml"), JSON.stringify({ contexts: [name] }));
		await assert.rejects(
			collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, contextDirectory),
			new RegExp(`Unknown context source: ${name}`),
		);
	}
});

test("collectPreload does not import an unselected context source", async (t) => {
	const { project, presetDirectory, contextDirectory } = await createDynamicFixture(t);
	await Promise.all([
		writeContextSource(contextDirectory, "unselected", {
			facts: "export default (\n",
			template: "unused",
		}),
		writeFile(join(project, "CONTEXT_PRELOAD.yml"), JSON.stringify({ files: ["selected.txt"] })),
		writeFile(join(project, "selected.txt"), "selected"),
	]);

	const result = await collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, contextDirectory);

	assert.ok(result);
	assert.equal(result.count, 1);
	assert.equal(textBlocks(result.blocks)[0]?.text, "File: selected.txt\n\nselected");
});

test("collectPreload skips rendering when context facts are undefined", async (t) => {
	const { project, presetDirectory, contextDirectory } = await createDynamicFixture(t);
	await Promise.all([
		writeContextSource(contextDirectory, "not-applicable", {
			facts: "export default async function () { return undefined; }\n",
			template: "{{ facts.missing }}",
		}),
		writeFile(join(project, "CONTEXT_PRELOAD.yml"), JSON.stringify({ contexts: ["not-applicable"] })),
	]);

	const result = await collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, contextDirectory);

	assert.ok(result);
	assert.equal(result.count, 0);
	const blocks = textBlocks(result.blocks);
	assert.equal(blocks.length, 1);
	assert.match(blocks[0]?.text ?? "", /^File: TREE\.txt\n\n/);
});

test("collectPreload renders package context before files with one final newline", async (t) => {
	const { project, presetDirectory, contextDirectory } = await createDynamicFixture(t);
	await Promise.all([
		writeContextSource(contextDirectory, "sample", {
			facts: 'export default async function () { return { name: "fixture", detail: "included" }; }\n',
			template: 'Project: {{ facts.name }}\r\n{% include "sample/fragment.md" %}',
			fragments: { "fragment.md": "Fragment: {{ facts.detail }}\r\n" },
		}),
		writeFile(join(project, "CONTEXT_PRELOAD.yml"), JSON.stringify({ contexts: ["sample"], files: ["selected.txt"] })),
		writeFile(join(project, "selected.txt"), "selected"),
	]);

	const result = await collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, contextDirectory);

	assert.ok(result);
	assert.equal(result.count, 1);
	assert.equal(result.bytes, Buffer.byteLength("selected"));
	const blocks = textBlocks(result.blocks);
	assert.equal(blocks[0]?.text, "Context: sample\n\nProject: fixture\nFragment: included\n");
	assert.equal(blocks[1]?.text, "File: selected.txt\n\nselected");
	assert.match(blocks[2]?.text ?? "", /^File: TREE\.txt\n\n/);
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
		writeContextSource(contextDirectory, "strict-undefined", {
			template: "{{ facts.missing }}",
		}),
	]);

	const cases: Array<[string, RegExp]> = [
		["import-error", /Context source import-error import failed:/],
		["invalid-export", /Context source invalid-export facts\.ts default export must be a function/],
		["execution-error", /Context source execution-error execution failed: loader boom/],
		["render-error", /Context source render-error render failed:/],
		["strict-undefined", /Context source strict-undefined render failed:/],
	];
	for (const [name, pattern] of cases) {
		await writeFile(join(project, "CONTEXT_PRELOAD.yml"), JSON.stringify({ contexts: [name] }));
		await assert.rejects(
			collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, contextDirectory),
			pattern,
		);
	}
});

test("collectPreload applies dynamic block and combined context limits", async (t) => {
	await t.test("dynamic block limit", async (t) => {
		const { project, presetDirectory, contextDirectory } = await createDynamicFixture(t);
		await Promise.all([
			writeContextSource(contextDirectory, "too-large", { template: "x".repeat(256 * 1024) }),
			writeFile(join(project, "CONTEXT_PRELOAD.yml"), JSON.stringify({ contexts: ["too-large"] })),
		]);

		await assert.rejects(
			collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, contextDirectory),
			/block limit/,
		);
	});

	await t.test("combined dynamic and file limit", async (t) => {
		const { project, presetDirectory, contextDirectory } = await createDynamicFixture(t);
		const names = ["large-0", "large-1", "large-2", "large-3"];
		await Promise.all(
			names.map((name) => writeContextSource(contextDirectory, name, { template: "x".repeat(255 * 1024) })),
		);
		await Promise.all([
			writeFile(join(project, "CONTEXT_PRELOAD.yml"), JSON.stringify({ contexts: names, files: ["selected.txt"] })),
			writeFile(join(project, "selected.txt"), "x".repeat(8 * 1024)),
		]);

		await assert.rejects(
			collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, contextDirectory),
			/Context with headings is over/,
		);
	});
});

test("parseDioxusMetadata detects workspace Dioxus dependency forms", () => {
	const requirements = ["^0.7", "~0.7", "=0.7.10", ">=0.7", "0.7"];
	const metadata: Parameters<typeof parseDioxusMetadata>[0] = {
		packages: [
			{
				id: "direct",
				name: "direct-app",
				dependencies: [{ name: "dioxus", req: requirements[0], kind: null, features: ["web"] }],
				features: {},
			},
			{
				id: "workspace",
				name: "workspace-app",
				dependencies: [{ name: "dioxus", req: requirements[1], kind: null, features: ["server"] }],
				features: {},
			},
			{
				id: "renamed",
				name: "renamed-app",
				dependencies: [{ name: "dioxus", rename: "dx", req: requirements[2], kind: null, features: ["desktop"] }],
				features: { desktop: ["dx/desktop"] },
			},
			{
				id: "optional",
				name: "optional-app",
				dependencies: [{ name: "dioxus", req: requirements[3], kind: null, optional: true, features: ["mobile"] }],
				features: {},
			},
			{
				id: "targeted",
				name: "targeted-app",
				dependencies: [
					{
						name: "dioxus",
						req: requirements[4],
						kind: null,
						target: 'cfg(target_arch = "wasm32")',
						features: ["native"],
					},
				],
				features: {},
			},
			{
				id: "outside",
				name: "outside-app",
				dependencies: [{ name: "dioxus", req: "*", kind: null, features: ["fullstack"] }],
				features: {},
			},
		],
		workspace_members: ["direct", "workspace", "renamed", "optional", "targeted"],
	};

	const facts = parseDioxusMetadata(metadata);

	assert.ok(facts);
	assert.deepEqual(
		facts.packageNames,
		["direct-app", "workspace-app", "renamed-app", "optional-app", "targeted-app"].sort(),
	);
	assert.deepEqual(facts.versionRequirements, requirements.sort());
	assert.deepEqual(facts.declaredFeatures, ["desktop", "mobile", "native", "server", "web"]);
	assert.deepEqual(facts.forwardedFeatures, ["desktop"]);
	assert.deepEqual(facts.defaultFeatures, []);
	assert.deepEqual(facts.platforms, ["desktop", "mobile", "native", "server", "web"]);
	assert.equal(facts.fullstack, false);
	assert.equal(facts.router, false);
});

test("parseDioxusMetadata separates direct, forwarded, and recursive default features", () => {
	const metadata = {
		packages: [
			{
				id: "app",
				name: "app",
				dependencies: [{ name: "dioxus", rename: "dx", req: "^0.7", kind: null, features: ["fullstack", "web"] }],
				features: {
					default: ["ui"],
					ui: ["dx/mobile", "nested"],
					nested: ["cycle", "dx?/server"],
					cycle: ["nested"],
					extra: ["dx/native"],
					routing: ["dx/router"],
				},
			},
		],
		workspace_members: ["app"],
	};

	const facts = parseDioxusMetadata(metadata);

	assert.ok(facts);
	assert.deepEqual(facts.declaredFeatures, ["fullstack", "web"]);
	assert.deepEqual(facts.forwardedFeatures, ["mobile", "native", "router", "server"]);
	assert.deepEqual(facts.defaultFeatures, ["mobile", "server"]);
	assert.deepEqual(facts.platforms, ["mobile", "native", "server", "web"]);
	assert.equal(facts.fullstack, true);
	assert.equal(facts.router, true);
	assert.deepEqual(facts, parseDioxusMetadata(structuredClone(metadata)));

	const dependencyRouter = parseDioxusMetadata({
		packages: [
			{
				id: "router-app",
				name: "router-app",
				dependencies: [
					{ name: "dioxus", req: "^0.7", kind: null, features: [] },
					{ name: "dioxus-router", req: "^0.7", kind: null, features: [] },
				],
				features: {},
			},
		],
		workspace_members: ["router-app"],
	});
	assert.equal(dependencyRouter?.router, true);
});

test("parseDioxusMetadata returns undefined without a workspace Dioxus dependency", () => {
	assert.equal(
		parseDioxusMetadata({
			packages: [
				{
					id: "app",
					name: "app",
					dependencies: [{ name: "dioxus-router", req: "^0.7", kind: null, features: [] }],
					features: {},
				},
				{
					id: "outside",
					name: "outside",
					dependencies: [{ name: "dioxus", req: "^0.7", kind: null, features: ["web"] }],
					features: {},
				},
			],
			workspace_members: ["app"],
		}),
		undefined,
	);
});

test("Dioxus template follows every inclusion-matrix condition", () => {
	const environment = new nunjucks.Environment(
		new nunjucks.FileSystemLoader(join(import.meta.dirname, "..", "context"), { noCache: true }),
		{ autoescape: false, throwOnUndefined: true },
	);
	const baseFacts: DioxusFacts = {
		packageNames: ["app"],
		versionRequirements: ["^0.7"],
		declaredFeatures: [],
		forwardedFeatures: [],
		defaultFeatures: [],
		platforms: [],
		fullstack: false,
		router: false,
	};
	const render = (facts: Partial<DioxusFacts> = {}) =>
		environment.render("dioxus/index.md.njk", { facts: { ...baseFacts, ...facts } });
	const groups: Array<{ facts: Partial<DioxusFacts>; headings: string[] }> = [
		{ facts: { router: true }, headings: ["# Dioxus Routing"] },
		{
			facts: { fullstack: true },
			headings: [
				"# Full-Stack Initial Setup",
				"# Full-Stack Runtime",
				"# Full-Stack Authentication",
				"# Full-Stack Real-Time and Streaming",
			],
		},
		{ facts: { platforms: ["server"] }, headings: ["# Server Initial Setup", "# Server Runtime"] },
		{
			facts: { platforms: ["web"] },
			headings: ["# Web Initial Setup", "# Web Runtime", "# Web PWA Integration"],
		},
		{
			facts: { platforms: ["desktop"] },
			headings: ["# Desktop Initial Setup", "# Desktop Runtime", "# Desktop Custom Rendering"],
		},
		{
			facts: { platforms: ["mobile"] },
			headings: ["# Mobile Initial Setup", "# Mobile Runtime", "# Mobile Native Plug-Ins"],
		},
	];
	const allConditionalHeadings = groups.flatMap((group) => group.headings);
	const coreOnly = render();
	assert.match(coreOnly, /# Detected Dioxus Project/);
	assert.match(coreOnly, /Workspace packages: app/);
	assert.match(coreOnly, /Version requirements: \^0\.7/);
	assert.match(coreOnly, /Declared Dioxus features: none/);
	assert.match(coreOnly, /Default-path Dioxus features: none/);
	assert.match(coreOnly, /# Dioxus Core Context/);
	for (const heading of allConditionalHeadings) assert.ok(!coreOnly.includes(heading));

	for (const group of groups) {
		const rendered = render(group.facts);
		assert.match(rendered, /# Dioxus Core Context/);
		for (const heading of group.headings) assert.ok(rendered.includes(heading));
		for (const heading of allConditionalHeadings) {
			if (!group.headings.includes(heading)) assert.ok(!rendered.includes(heading));
		}
	}
});
