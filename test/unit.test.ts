import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { TextContent } from "@earendil-works/pi-ai";
import nunjucks from "nunjucks";
import type { PiPreloadConfiguration as Configuration } from "pi-agents-yaml";
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
	const contextDirectory = join(root, "context");
	await Promise.all([mkdir(project), mkdir(contextDirectory)]);
	return { project, contextDirectory };
}

async function writeContextSource(
	contextDirectory: string,
	name: string,
	options: { facts?: string; template: string },
) {
	const sourceDirectory = join(contextDirectory, name);
	await mkdir(sourceDirectory, { recursive: true });
	await Promise.all([
		writeFile(join(sourceDirectory, "facts.ts"), options.facts ?? "export default async function () { return {}; }\n"),
		writeFile(join(sourceDirectory, "index.md.njk"), options.template),
	]);
}

test("collectPreload uses package-owned empty defaults when pi-preload is missing", async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-preload-unit-"));
	t.after(async () => rm(project, { recursive: true, force: true }));
	await Promise.all([
		writeFile(join(project, "AGENTS.yml"), JSON.stringify({ "pi-tree": {} })),
		writeFile(join(project, "selected.txt"), "not preloaded"),
	]);

	const result = await collectPreload(project, AbortSignal.timeout(5_000));
	assert.deepEqual(result, { blocks: [], count: 0, contextBytes: 1 });
	assert.equal(await readFile(join(project, "PRELOAD.md"), "utf8"), "\n");
});

test("collectPreload resolves selected contexts and reports scoped failures", async (t) => {
	await t.test("orders and deduplicates contexts before files", async (t) => {
		const { project, contextDirectory } = await createDynamicFixture(t);
		await Promise.all([
			writeContextSource(contextDirectory, "first", {
				facts: 'export default async function () { return { name: "fixture", detail: "included" }; }\n',
				template: "Project: {{ facts.name }} · {{ facts.detail }}\n",
			}),
			writeContextSource(contextDirectory, "second", { template: "second\n" }),
			writeContextSource(contextDirectory, "not-applicable", {
				facts: "export default async function () { return undefined; }\n",
				template: "unused",
			}),
		]);

		const result = await collectPreload(
			project,
			AbortSignal.timeout(5_000),
			{ contexts: ["first", "second", "second", "first", "not-applicable"] },
			contextDirectory,
		);

		assert.ok(result);
		assert.equal(result.count, 2);
		assert.equal(result.contextBytes, Buffer.byteLength(await readFile(join(project, "PRELOAD.md"), "utf8")));
		assert.deepEqual(
			textBlocks(result.blocks).map((block) => block.text),
			["Context: first\n\nProject: fixture · included\n", "Context: second\n\nsecond\n"],
		);
		const snapshot = await readFile(join(project, "PRELOAD.md"), "utf8");
		assert.ok(snapshot.indexOf("Context: first") < snapshot.indexOf("Context: second"));
		assert.ok(snapshot.includes("Project: fixture · included"));
	});

	await t.test("names execution and render failures", async (t) => {
		const { project, contextDirectory } = await createDynamicFixture(t);
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
			collectPreload(project, AbortSignal.timeout(5_000), { contexts: ["execution-error"] }, contextDirectory),
			/Context source execution-error execution failed: loader boom/,
		);
		await assert.rejects(
			collectPreload(project, AbortSignal.timeout(5_000), { contexts: ["render-error"] }, contextDirectory),
			/Context source render-error render failed:/,
		);
	});
});

test("collectPreload applies dynamic block and combined context limits", async (t) => {
	await t.test("dynamic block limit", async (t) => {
		const { project, contextDirectory } = await createDynamicFixture(t);
		const configuration: Configuration = { contexts: ["too-large"] };
		await writeContextSource(contextDirectory, "too-large", { template: "x".repeat(256 * 1024) });

		await assert.rejects(
			collectPreload(project, AbortSignal.timeout(5_000), configuration, contextDirectory),
			/block limit/,
		);
	});

	await t.test("combined generated context limit", async (t) => {
		const { project, contextDirectory } = await createDynamicFixture(t);
		const names = Array.from({ length: 9 }, (_, index) => `large-${index}`);
		await Promise.all(
			names.map((name) => writeContextSource(contextDirectory, name, { template: "x".repeat(255 * 1024) })),
		);
		const configuration: Configuration = { contexts: names };

		await assert.rejects(
			collectPreload(project, AbortSignal.timeout(5_000), configuration, contextDirectory),
			/Generated context is over/,
		);
	});
});

test("collectPreload follows nested project references", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-preload-unit-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const parent = join(root, "parent");
	const middle = join(parent, "vendor", "middle");
	const inner = join(middle, "inner");
	const contextDirectory = join(root, "context");
	await Promise.all([
		mkdir(join(parent, ".git"), { recursive: true }),
		mkdir(inner, { recursive: true }),
		mkdir(contextDirectory),
	]);
	await Promise.all([
		writeContextSource(contextDirectory, "probe", {
			facts: "export default async function ({ cwd }) { return { root: cwd }; }\n",
			template: "Root: {{ facts.root }}\n",
		}),
		writeFile(join(parent, ".gitignore"), "vendor/\n"),
		writeFile(
			join(middle, "AGENTS.yml"),
			JSON.stringify({ "pi-preload": { extends: ["./inner"], contexts: ["probe"] } }),
		),
		writeFile(join(inner, "AGENTS.yml"), JSON.stringify({ "pi-preload": { contexts: ["probe"] } })),
	]);

	const result = await collectPreload(
		parent,
		AbortSignal.timeout(5_000),
		{ extends: ["./vendor/middle"], contexts: ["probe"] },
		contextDirectory,
	);

	assert.equal(result.count, 3);
	assert.deepEqual(
		textBlocks(result.blocks).map((block) => block.text),
		[inner, middle, parent].map((projectRoot) => `Context: probe\n\nRoot: ${projectRoot}\n`),
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

	const rendered = renderDioxusContext({ platforms: ["web"], fullstack: true, router: true });
	for (const fragment of fragments) assert.ok(rendered.includes(fragment.trim()));
});
