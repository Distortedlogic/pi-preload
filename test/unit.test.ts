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
	const root = await mkdtemp(join(tmpdir(), "pi-context-preload-unit-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const project = join(root, "project");
	const presetDirectory = join(root, "presets");
	const contextDirectory = join(root, "context");
	await Promise.all([mkdir(project), mkdir(presetDirectory), mkdir(contextDirectory)]);
	return { project, presetDirectory, contextDirectory };
}

async function writePreloadConfiguration(
	project: string,
	configuration: Configuration,
	otherConfiguration: Record<string, unknown> = {},
) {
	await writeFile(
		join(project, "AGENTS.yml"),
		JSON.stringify({ ...otherConfiguration, "pi-context-preload": configuration }),
	);
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
	const root = await mkdtemp(join(tmpdir(), "pi-context-preload-unit-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const project = join(root, "project");
	const presetDirectory = join(root, "presets");
	const sourcePattern = join(project, "src", "**", "*.ts");
	const excludedPattern = `!${join(project, "src", "excluded.ts")}`;
	await Promise.all([mkdir(join(project, "src"), { recursive: true }), mkdir(presetDirectory)]);
	const configuration: Configuration = { extends: ["common"], files: ["local.txt", excludedPattern] };
	await Promise.all([
		writePreloadConfiguration(project, configuration),
		writeFile(join(presetDirectory, "common.yml"), JSON.stringify({ files: [sourcePattern] })),
		writeFile(join(project, "src", "included.ts"), "included"),
		writeFile(join(project, "src", "excluded.ts"), "excluded"),
		writeFile(join(project, "local.txt"), "local"),
	]);

	const result = await collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, undefined, configuration);

	assert.ok(result);
	assert.equal(result.count, 2);
	assert.deepEqual(fileBlockPaths(result.blocks), ["local.txt", join(project, "src", "included.ts")]);
});

test("collectPreload excludes generated, ignored, and lock files from content", async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-context-preload-unit-"));
	t.after(async () => rm(project, { recursive: true, force: true }));
	await Promise.all([mkdir(join(project, ".git")), mkdir(join(project, "ignored")), mkdir(join(project, "nested"))]);
	const configuration: Configuration = { files: ["**/*", "PRELOAD.md", "TREE.txt", "!excluded.ts"] };
	await Promise.all([
		writePreloadConfiguration(project, configuration),
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

	await writeFile(join(project, "PRELOAD.md"), "stale snapshot");
	const repeatedResult = await collectPreload(
		project,
		AbortSignal.timeout(5_000),
		undefined,
		undefined,
		configuration,
	);
	assert.ok(repeatedResult);
	assert.equal(repeatedResult.count, 1);
	assert.deepEqual(
		textBlocks(repeatedResult.blocks).map((block) => block.text),
		[fileBlock("source.ts", "source")],
	);
	assert.equal(await readFile(join(project, "TREE.txt"), "utf8"), "stale tree");
	assert.equal(await readFile(join(project, "PRELOAD.md"), "utf8"), `${fileBlock("source.ts", "source")}\n`);
});

test("collectPreload validates presets with the shared configuration schema", async (t) => {
	const { project, presetDirectory, contextDirectory } = await createDynamicFixture(t);
	const configuration: Configuration = { extends: ["invalid"] };
	await Promise.all([
		writePreloadConfiguration(project, configuration),
		writeFile(join(presetDirectory, "invalid.yml"), JSON.stringify({ files: [42] })),
	]);

	await assert.rejects(
		collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, contextDirectory, configuration),
		/invalid\.yml.*pi-context-preload/,
	);
});

test("collectPreload rejects an explicitly selected non-image binary", async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-context-preload-unit-"));
	t.after(async () => rm(project, { recursive: true, force: true }));
	const configuration: Configuration = { files: ["invalid.txt"] };
	await Promise.all([
		writePreloadConfiguration(project, configuration),
		writeFile(join(project, "invalid.txt"), Uint8Array.from([0xff])),
	]);

	await assert.rejects(
		collectPreload(project, AbortSignal.timeout(5_000), undefined, undefined, configuration),
		/explicitly selected binary file/,
	);
});

test("collectPreload snapshots image blocks in returned order", async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-context-preload-unit-"));
	t.after(async () => rm(project, { recursive: true, force: true }));
	const image = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
		"base64",
	);
	const configuration: Configuration = { files: ["image.png"] };
	await Promise.all([
		writePreloadConfiguration(project, configuration),
		writeFile(join(project, "image.png"), image),
	]);

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
		writePreloadConfiguration(project, configuration),
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
		await writePreloadConfiguration(project, configuration);
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
		const configuration: Configuration = { contexts: [name] };
		await writePreloadConfiguration(project, configuration);
		await assert.rejects(
			collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, contextDirectory, configuration),
			new RegExp(`Unknown context source: ${name}`),
		);
	}
});

test("collectPreload does not import an unselected context source", async (t) => {
	const { project, presetDirectory, contextDirectory } = await createDynamicFixture(t);
	const configuration: Configuration = { files: ["selected.txt"] };
	await Promise.all([
		writeContextSource(contextDirectory, "unselected", {
			facts: "export default (\n",
			template: "unused",
		}),
		writePreloadConfiguration(project, configuration),
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
		writePreloadConfiguration(project, configuration),
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
		writePreloadConfiguration(project, configuration),
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
		const configuration: Configuration = { contexts: [name] };
		await writePreloadConfiguration(project, configuration);
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
		await Promise.all([
			writeContextSource(contextDirectory, "too-large", { template: "x".repeat(256 * 1024) }),
			writePreloadConfiguration(project, configuration),
		]);

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
		await Promise.all([
			writePreloadConfiguration(project, configuration),
			writeFile(join(project, "selected.txt"), "x".repeat(8 * 1024)),
		]);

		await assert.rejects(
			collectPreload(project, AbortSignal.timeout(5_000), presetDirectory, contextDirectory, configuration),
			/Context with headings is over/,
		);
	});
});

test("parseDioxusMetadata selects the deepest package that contains cwd", () => {
	const workspaceRoot = join(tmpdir(), "dioxus-selection");
	const metadata: Parameters<typeof parseDioxusMetadata>[0] = {
		packages: [
			{
				id: "root-app",
				name: "root-app",
				manifest_path: join(workspaceRoot, "apps", "root", "Cargo.toml"),
				dependencies: [
					{ name: "dioxus", kind: null, features: ["fullstack", "web"] },
					{ name: "dioxus-router", kind: null },
				],
				features: {},
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
	};

	assert.deepEqual(parseDioxusMetadata(metadata, join(workspaceRoot, "apps", "root", "nested", "src")), {
		platforms: ["desktop"],
		fullstack: false,
		router: false,
	});
});

test("parseDioxusMetadata selects the only Dioxus default member outside package directories", () => {
	const workspaceRoot = join(tmpdir(), "dioxus-default-member");
	const metadata: Parameters<typeof parseDioxusMetadata>[0] = {
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
	};

	assert.deepEqual(parseDioxusMetadata(metadata, join(workspaceRoot, "tools")), {
		platforms: ["mobile"],
		fullstack: false,
		router: false,
	});
});

test("parseDioxusMetadata selects the only Dioxus workspace package", () => {
	const workspaceRoot = join(tmpdir(), "dioxus-only-member");
	const metadata: Parameters<typeof parseDioxusMetadata>[0] = {
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
	};

	assert.deepEqual(parseDioxusMetadata(metadata, join(workspaceRoot, "tools")), {
		platforms: ["server"],
		fullstack: false,
		router: false,
	});
});

test("parseDioxusMetadata returns core-only facts for an ambiguous workspace", () => {
	const workspaceRoot = join(tmpdir(), "dioxus-ambiguous");
	const metadata: Parameters<typeof parseDioxusMetadata>[0] = {
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
	};

	assert.deepEqual(parseDioxusMetadata(metadata, workspaceRoot), {
		platforms: [],
		fullstack: false,
		router: false,
	});
});

test("parseDioxusMetadata uses direct and default-reachable features only", () => {
	const workspaceRoot = join(tmpdir(), "dioxus-features");
	const metadata: Parameters<typeof parseDioxusMetadata>[0] = {
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
	};

	assert.deepEqual(parseDioxusMetadata(metadata, join(workspaceRoot, "app", "src")), {
		platforms: ["server", "web"],
		fullstack: true,
		router: false,
	});

	metadata.packages[0].dependencies?.push({ name: "dioxus-router", kind: null });
	assert.equal(parseDioxusMetadata(metadata, workspaceRoot)?.router, true);
});

test("parseDioxusMetadata returns undefined without a workspace Dioxus dependency", () => {
	const workspaceRoot = join(tmpdir(), "no-dioxus");
	assert.equal(
		parseDioxusMetadata(
			{
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
			join(workspaceRoot, "app"),
		),
		undefined,
	);
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
const dioxusContextBaselineBytes = {
	coreOnly: 3861,
	router: 4168,
	fullstackWebServer: 14634,
	unrelatedWorkspace: 22008,
} satisfies Record<keyof typeof dioxusContextScenarios, number>;
const dioxusContextByteBudgets = {
	coreOnly: 1200,
	router: 1400,
	fullstackWebServer: 3000,
	unrelatedWorkspace: 1200,
} satisfies Record<keyof typeof dioxusContextScenarios, number>;

function renderDioxusContext(facts: DioxusFacts) {
	return dioxusEnvironment.render("dioxus/index.md.njk", { facts });
}

test("records representative Dioxus context baseline byte counts and budgets", () => {
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
		assert.ok(renderedBytes[name] < dioxusContextBaselineBytes[name]);
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

test("package includes the Dioxus specialized skill and all references", async () => {
	const packageRoot = join(import.meta.dirname, "..");
	const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {
		files?: string[];
		pi?: { skills?: string[] };
	};
	assert.ok(manifest.files?.includes("skills"));
	assert.ok(manifest.pi?.skills?.includes("./skills"));

	const skillDirectory = join(packageRoot, "skills", "dioxus-specialized");
	const skill = await readFile(join(skillDirectory, "SKILL.md"), "utf8");
	const references = [
		"project-setup.md",
		"state-store.md",
		"advanced-routing.md",
		"assets-tailwind.md",
		"fullstack-auth.md",
		"fullstack-streaming.md",
		"server-integration.md",
		"web-pwa.md",
		"desktop-integration.md",
		"mobile-native.md",
	];
	for (const reference of references) {
		assert.ok(skill.includes(`references/${reference}`));
		assert.ok((await readFile(join(skillDirectory, "references", reference), "utf8")).trim().length > 0);
	}
});
