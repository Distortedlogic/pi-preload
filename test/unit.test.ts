import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import type { TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import nunjucks from "nunjucks";
import type { PiPreloadConfiguration as Configuration } from "pi-agents-yaml";
import { type DioxusFacts, parseDioxusMetadata } from "../context/dioxus/facts.ts";
import { collectPreload } from "../src/index.ts";
import { registerSignatureRead } from "../src/signature-read.ts";

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

test("collectPreload writes selected text files with canonical markers", async (t) => {
	const { project, contextDirectory } = await createDynamicFixture(t);
	await mkdir(join(project, "src"));
	await Promise.all([
		writeFile(join(project, "src", "selected.ts"), "selected"),
		writeFile(join(project, "src", "excluded.ts"), "excluded"),
	]);

	const result = await collectPreload(
		project,
		AbortSignal.timeout(5_000),
		{ includes: ["src/*.ts"], excludes: ["src/excluded.ts"] },
		contextDirectory,
	);

	assert.equal(result.count, 1);
	assert.deepEqual(fileBlockPaths(result.blocks), ["src/selected.ts"]);
	assert.equal(await readFile(join(project, "PRELOAD.md"), "utf8"), `${fileBlock("src/selected.ts", "selected")}\n`);
});

test("collectPreload uses package-owned empty defaults when pi-preload is missing", async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-preload-unit-"));
	t.after(async () => rm(project, { recursive: true, force: true }));
	await Promise.all([
		writeFile(join(project, "AGENTS.yml"), JSON.stringify({ "pi-tree": { includes: ["selected.txt"] } })),
		writeFile(join(project, "selected.txt"), "not preloaded"),
	]);

	const result = await collectPreload(project, AbortSignal.timeout(5_000));
	assert.deepEqual(result, { blocks: [], count: 0, contextBytes: 1, sourceBytes: 0 });
	assert.equal(await readFile(join(project, "PRELOAD.md"), "utf8"), "\n");
});

test("collectPreload merges signatures and project references with full-mode precedence", async (t) => {
	const { project, contextDirectory } = await createDynamicFixture(t);
	const child = join(project, "child");
	const presetPath = join(project, "preset.ts");
	await mkdir(child);
	await Promise.all([
		writeFile(join(child, "AGENTS.yml"), JSON.stringify({ "pi-preload": { signatures: ["child.ts"] } })),
		writeFile(presetPath, 'export function preset() { return "preset implementation"; }\n'),
		writeFile(join(child, "child.ts"), 'export function child() { return "child implementation"; }\n'),
		writeFile(join(project, "own.ts"), 'export function own() { return "own implementation"; }\n'),
		writeFile(join(project, "overlap.ts"), 'export function overlap() { return "full implementation"; }\n'),
	]);

	const result = await collectPreload(
		project,
		AbortSignal.timeout(5_000),
		{
			extends: ["./child"],
			signatures: [presetPath, "own.ts", "overlap.ts"],
			includes: ["overlap.ts"],
		},
		contextDirectory,
	);

	assert.ok(result);
	assert.deepEqual(fileBlockPaths(result.blocks).sort(), ["child/child.ts", "overlap.ts", "own.ts", "preset.ts"]);
	const snapshot = await readFile(join(project, "PRELOAD.md"), "utf8");
	for (const declaration of ["function child()", "function own()", "function preset()", "function overlap()"]) {
		assert.ok(snapshot.includes(declaration));
	}
	assert.doesNotMatch(snapshot, /child implementation|own implementation|preset implementation/);
	assert.match(snapshot, /full implementation/);
});

function preloadedFile(snapshot: string, path: string): string {
	const label = JSON.stringify(path);
	const start = `===== BEGIN FILE ${label} =====\n`;
	const end = `===== END FILE ${label} =====`;
	const startIndex = snapshot.indexOf(start);
	assert.notEqual(startIndex, -1, `${path} start marker is missing`);
	const contentStart = startIndex + start.length;
	const endIndex = snapshot.indexOf(end, contentStart);
	assert.notEqual(endIndex, -1, `${path} end marker is missing`);
	return snapshot.slice(contentStart, endIndex);
}

test("collectPreload uses GritQL to fold callable bodies across supported languages", async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-preload-fold-"));
	t.after(async () => rm(project, { recursive: true, force: true }));
	const sourceDirectory = join(project, "src");
	await mkdir(sourceDirectory);
	await Promise.all([
		writeFile(
			join(sourceDirectory, "fixture.js"),
			[
				'const javascriptBrace = "{ javascript brace }";',
				"// javascript comment { stays }",
				"function javascriptOuter() {",
				'\tfunction javascriptNested() { return "JAVASCRIPT_NESTED_IMPLEMENTATION"; }',
				'\treturn "JAVASCRIPT_IMPLEMENTATION";',
				"}",
				'const javascriptArrow = () => "JAVASCRIPT_ARROW_IMPLEMENTATION";',
				"class JavaScriptBox {",
				'\tconstructor() { this.value = "JAVASCRIPT_CONSTRUCTOR_IMPLEMENTATION"; }',
				'\tmethod() { return "JAVASCRIPT_METHOD_IMPLEMENTATION"; }',
				"}",
				"",
			].join("\n"),
		),
		writeFile(
			join(sourceDirectory, "fixture.ts"),
			[
				"function typescriptOuter(): string {",
				'\tfunction typescriptNested(): string { return "TYPESCRIPT_NESTED_IMPLEMENTATION"; }',
				'\treturn "TYPESCRIPT_IMPLEMENTATION";',
				"}",
				'const typescriptArrow = (): string => "TYPESCRIPT_ARROW_IMPLEMENTATION";',
				"class TypeScriptBox {",
				'\tconstructor() { this.value = "TYPESCRIPT_CONSTRUCTOR_IMPLEMENTATION"; }',
				'\tmethod(): string { return "TYPESCRIPT_METHOD_IMPLEMENTATION"; }',
				'\tprivate value = "";',
				"}",
				"",
			].join("\n"),
		),
		writeFile(
			join(sourceDirectory, "fixture.py"),
			[
				"def python_outer():",
				"    def python_nested():",
				'        return "PYTHON_NESTED_IMPLEMENTATION"',
				'    return "PYTHON_IMPLEMENTATION"',
				"class PythonBox:",
				"    def __init__(self):",
				'        self.value = "PYTHON_CONSTRUCTOR_IMPLEMENTATION"',
				"    def method(self):",
				'        return "PYTHON_METHOD_IMPLEMENTATION"',
				"",
			].join("\n"),
		),
		writeFile(
			join(sourceDirectory, "fixture.rs"),
			[
				"fn rust_outer() -> &'static str {",
				'\tfn rust_nested() -> &\'static str { "RUST_NESTED_IMPLEMENTATION" }',
				'\t"RUST_IMPLEMENTATION"',
				"}",
				"struct RustBox;",
				"impl RustBox {",
				'\tfn new() -> Self { let _value = "RUST_CONSTRUCTOR_IMPLEMENTATION"; Self }',
				'\tfn method(&self) -> &\'static str { "RUST_METHOD_IMPLEMENTATION" }',
				"}",
				"",
			].join("\n"),
		),
		writeFile(
			join(sourceDirectory, "fixture.go"),
			[
				"package fixture",
				"func goOuter() string {",
				'\tnested := func() string { return "GO_NESTED_IMPLEMENTATION" }',
				"\t_ = nested",
				'\treturn "GO_IMPLEMENTATION"',
				"}",
				"type GoBox struct{}",
				'func NewGoBox() *GoBox { value := "GO_CONSTRUCTOR_IMPLEMENTATION"; _ = value; return &GoBox{} }',
				'func (box *GoBox) Method() string { return "GO_METHOD_IMPLEMENTATION" }',
				"",
			].join("\n"),
		),
	]);

	const result = await collectPreload(project, AbortSignal.timeout(5_000), { signatures: ["src/**/*"] });
	assert.ok(result);
	const snapshot = await readFile(join(project, "PRELOAD.md"), "utf8");
	for (const declaration of [
		"function javascriptOuter()",
		"const javascriptArrow",
		"class JavaScriptBox",
		"constructor()",
		"method()",
		"function typescriptOuter()",
		"const typescriptArrow",
		"class TypeScriptBox",
		"method(): string",
		"def python_outer():",
		"def __init__(self):",
		"def method(self):",
		"fn rust_outer()",
		"fn new()",
		"fn method(&self)",
		"func goOuter()",
		"func NewGoBox()",
		"func (box *GoBox) Method()",
	]) {
		assert.ok(snapshot.includes(declaration), declaration);
	}
	for (const implementation of [
		"JAVASCRIPT_IMPLEMENTATION",
		"JAVASCRIPT_NESTED_IMPLEMENTATION",
		"JAVASCRIPT_ARROW_IMPLEMENTATION",
		"JAVASCRIPT_CONSTRUCTOR_IMPLEMENTATION",
		"JAVASCRIPT_METHOD_IMPLEMENTATION",
		"TYPESCRIPT_IMPLEMENTATION",
		"TYPESCRIPT_NESTED_IMPLEMENTATION",
		"TYPESCRIPT_ARROW_IMPLEMENTATION",
		"TYPESCRIPT_CONSTRUCTOR_IMPLEMENTATION",
		"TYPESCRIPT_METHOD_IMPLEMENTATION",
		"PYTHON_IMPLEMENTATION",
		"PYTHON_NESTED_IMPLEMENTATION",
		"PYTHON_CONSTRUCTOR_IMPLEMENTATION",
		"PYTHON_METHOD_IMPLEMENTATION",
		"RUST_IMPLEMENTATION",
		"RUST_NESTED_IMPLEMENTATION",
		"RUST_CONSTRUCTOR_IMPLEMENTATION",
		"RUST_METHOD_IMPLEMENTATION",
		"GO_IMPLEMENTATION",
		"GO_NESTED_IMPLEMENTATION",
		"GO_CONSTRUCTOR_IMPLEMENTATION",
		"GO_METHOD_IMPLEMENTATION",
	]) {
		assert.ok(!snapshot.includes(implementation), implementation);
	}
	for (const preserved of ["{ javascript brace }", "javascript comment { stays }"]) {
		assert.ok(snapshot.includes(preserved), preserved);
	}
	for (const [path, declaration] of [
		["src/fixture.js", /function javascriptOuter\(\)[^{]*\{\s*\}/],
		["src/fixture.ts", /function typescriptOuter\(\)[^{]*\{\s*\}/],
		["src/fixture.rs", /fn rust_outer\(\)[^{]*\{\s*\}/],
		["src/fixture.go", /func goOuter\(\)[^{]*\{\s*\}/],
	] as const) {
		const folded = preloadedFile(snapshot, path);
		assert.doesNotMatch(folded, /\/\* … \*\//);
		assert.match(folded, declaration);
	}
	assert.equal(preloadedFile(snapshot, "src/fixture.py").split("...").length - 1, 3);
});

test("read_signatures folds the complete file before bounded output", async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-preload-signature-read-"));
	t.after(async () => rm(project, { recursive: true, force: true }));
	const payload = "x".repeat(80 * 1024);
	await writeFile(
		join(project, "api.ts"),
		`export function first() { return "${payload}"; }\nexport function second() { return 2; }\n`,
	);

	let registeredTool: unknown;
	registerSignatureRead({
		registerTool: (tool: unknown) => {
			registeredTool = tool;
		},
	} as unknown as ExtensionAPI);
	const execute = (
		registeredTool as {
			execute?: (...args: unknown[]) => Promise<unknown>;
		}
	).execute;
	if (!execute) assert.fail("read_signatures was not registered");

	const firstResult = (await execute(
		"signature-read-1",
		{ path: "api.ts", limit: 1 },
		AbortSignal.timeout(5_000),
		undefined,
		{ cwd: project },
	)) as {
		content: Array<{ text: string }>;
		details: { nextOffset?: number; truncated: boolean };
	};
	const firstPage = firstResult.content[0]?.text ?? "";
	assert.match(firstPage, /function first/);
	assert.doesNotMatch(firstPage, /x{100}/);
	assert.equal(firstResult.details.truncated, true);
	assert.equal(firstResult.details.nextOffset, 2);

	const secondResult = (await execute(
		"signature-read-2",
		{ path: "api.ts", offset: firstResult.details.nextOffset },
		AbortSignal.timeout(5_000),
		undefined,
		{ cwd: project },
	)) as { content: Array<{ text: string }> };
	assert.match(secondResult.content[0]?.text ?? "", /function second/);
	await assert.rejects(readFile(join(project, "PRELOAD.md"), "utf8"), /ENOENT/);
	await assert.rejects(
		execute("signature-read-unsupported", { path: "unsupported.txt" }, AbortSignal.timeout(5_000), undefined, {
			cwd: project,
		}),
		/does not support.*Use read/,
	);
});

test("collectPreload rejects an unsupported signature language", async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-preload-fold-"));
	t.after(async () => rm(project, { recursive: true, force: true }));
	await writeFile(join(project, "unsupported.txt"), "unsupported signature source\n");

	await assert.rejects(
		collectPreload(project, AbortSignal.timeout(5_000), { signatures: ["unsupported.txt"] }),
		/Signature folding does not support the file extension/,
	);
	await assert.rejects(readFile(join(project, "PRELOAD.md"), "utf8"), /ENOENT/);
});

test("collectPreload applies the total limit after signature folding", async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-preload-fold-"));
	t.after(async () => rm(project, { recursive: true, force: true }));
	const sourceDirectory = join(project, "src");
	await mkdir(sourceDirectory);
	const payload = "x".repeat(220 * 1024);
	const sources = Array.from(
		{ length: 10 },
		(_, index) => `export function large${index}() { return "SOURCE_${index}_${payload}"; }\n`,
	);
	await Promise.all(sources.map((source, index) => writeFile(join(sourceDirectory, `large-${index}.js`), source)));
	assert.ok(sources.reduce((total, source) => total + Buffer.byteLength(source), 0) > 2 * 1024 * 1024);

	const result = await collectPreload(project, AbortSignal.timeout(5_000), { signatures: ["src/*.js"] });
	assert.ok(result);
	const snapshot = await readFile(join(project, "PRELOAD.md"), "utf8");
	assert.ok(Buffer.byteLength(snapshot) < 2 * 1024 * 1024);
	assert.ok(!snapshot.includes(payload.slice(0, 1_000)));
	for (let index = 0; index < sources.length; index += 1) {
		assert.ok(snapshot.includes(`function large${index}()`));
	}
});

test("collectPreload handles selected media and writes canonical output", async (t) => {
	await t.test("rejects a selected non-image binary", async (t) => {
		const project = await mkdtemp(join(tmpdir(), "pi-preload-unit-"));
		t.after(async () => rm(project, { recursive: true, force: true }));
		await writeFile(join(project, "invalid.pdf"), Buffer.from("%PDF-1.7\n"));

		await assert.rejects(
			collectPreload(project, AbortSignal.timeout(5_000), { includes: ["invalid.pdf"] }),
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

		const result = await collectPreload(project, AbortSignal.timeout(5_000), { includes: ["image.png"] });

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
		const { project, contextDirectory } = await createDynamicFixture(t);
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
			writeFile(join(project, "selected.txt"), "selected"),
		]);

		const result = await collectPreload(
			project,
			AbortSignal.timeout(5_000),
			{
				contexts: ["first", "second", "second", "first", "not-applicable"],
				includes: ["selected.txt"],
			},
			contextDirectory,
		);

		assert.ok(result);
		assert.equal(result.count, 1);
		assert.equal(result.sourceBytes, Buffer.byteLength("selected"));
		assert.equal(result.contextBytes, Buffer.byteLength(await readFile(join(project, "PRELOAD.md"), "utf8")));
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

	await t.test("combined dynamic and file limit", async (t) => {
		const { project, contextDirectory } = await createDynamicFixture(t);
		const names = Array.from({ length: 9 }, (_, index) => `large-${index}`);
		await Promise.all(
			names.map((name) => writeContextSource(contextDirectory, name, { template: "x".repeat(255 * 1024) })),
		);
		const configuration: Configuration = { contexts: names, includes: ["selected.txt"] };
		await writeFile(join(project, "selected.txt"), "x".repeat(8 * 1024));

		await assert.rejects(
			collectPreload(project, AbortSignal.timeout(5_000), configuration, contextDirectory),
			/Context with headings is over/,
		);
	});
});

test("collectPreload follows nested project references", async (t) => {
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

		const result = await collectPreload(
			parent,
			AbortSignal.timeout(5_000),
			{ extends: ["./vendor/middle"], includes: ["parent.txt"] },
			contextDirectory,
		);

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
