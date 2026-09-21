import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { RpcClient } from "@earendil-works/pi-coding-agent";

const extensionPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const cliPath = join(dirname(codingAgentEntry), "cli.js");

function agentsConfiguration(configuration: unknown) {
	return JSON.stringify({ "pi-preload": configuration });
}

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

test("trusted Pi keeps one hidden preload message across reload", { timeout: 20_000 }, async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-preload-e2e-"));
	const reloadExtensionPath = join(project, "reload-extension.ts");
	await mkdir(join(project, "nested"));
	await Promise.all([
		writeFile(join(project, "AGENTS.yml"), agentsConfiguration({ includes: ["nested/**/*"] })),
		writeFile(join(project, "nested/context.txt"), "e2e preloaded text"),
		writeFile(
			reloadExtensionPath,
			[
				'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";',
				"export default function (pi: ExtensionAPI) {",
				'\tpi.registerCommand("reload-preload", {',
				"\t\thandler: async (_args, ctx) => {",
				"\t\t\tawait ctx.reload();",
				"\t\t},",
				"\t});",
				"}",
				"",
			].join("\n"),
		),
	]);

	const client = new RpcClient({
		cliPath,
		cwd: project,
		env: { PI_OFFLINE: "1" },
		args: [
			"--approve",
			"--no-session",
			"--no-extensions",
			"--extension",
			extensionPath,
			"--extension",
			reloadExtensionPath,
		],
	});
	t.after(async () => {
		await client.stop();
		await rm(project, { recursive: true, force: true });
	});
	await client.start();

	const assertSinglePreload = async () => {
		const messages = await client.getMessages();
		const preloadMessages = messages.filter(
			(message) => message.role === "custom" && message.customType === "pi-preload",
		);
		assert.equal(preloadMessages.length, 1);
		const preload = preloadMessages[0];
		assert.ok(preload);
		if (preload.role !== "custom") assert.fail("Expected a custom preload message");
		assert.equal(preload.display, false);
		await readFile(join(project, "PRELOAD.md"), "utf8");
	};

	await assertSinglePreload();
	await client.prompt("/reload-preload");
	await assertSinglePreload();
});

test("folds callable bodies across supported languages", { timeout: 120_000 }, async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-preload-e2e-"));
	const sourceDirectory = join(project, "src");
	await mkdir(sourceDirectory);
	await Promise.all([
		writeFile(join(project, "AGENTS.yml"), agentsConfiguration({ signatures: ["src/**/*"] })),
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
				'const typescriptBrace: string = "{ typescript brace }";',
				"// typescript comment { stays }",
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
				'PYTHON_BRACE = "{ python brace }"',
				"# python comment { stays }",
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
				'const RUST_BRACE: &str = "{ rust brace }";',
				"// rust comment { stays }",
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
				'const goBrace = "{ go brace }"',
				"// go comment { stays }",
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

	const client = new RpcClient({
		cliPath,
		cwd: project,
		env: { PI_OFFLINE: "1" },
		args: ["--approve", "--no-session", "--no-extensions", "--extension", extensionPath],
	});
	t.after(async () => {
		await client.stop();
		await rm(project, { recursive: true, force: true });
	});
	await client.start();
	await client.getMessages();

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
	for (const preserved of [
		"{ javascript brace }",
		"javascript comment { stays }",
		"{ typescript brace }",
		"typescript comment { stays }",
		"{ python brace }",
		"python comment { stays }",
		"{ rust brace }",
		"rust comment { stays }",
		"{ go brace }",
		"go comment { stays }",
	]) {
		assert.ok(snapshot.includes(preserved), preserved);
	}

	for (const [fileName, implementation] of [
		["fixture.js", "JAVASCRIPT_IMPLEMENTATION"],
		["fixture.ts", "TYPESCRIPT_IMPLEMENTATION"],
		["fixture.py", "PYTHON_IMPLEMENTATION"],
		["fixture.rs", "RUST_IMPLEMENTATION"],
		["fixture.go", "GO_IMPLEMENTATION"],
	] as const) {
		assert.ok((await readFile(join(sourceDirectory, fileName), "utf8")).includes(implementation));
	}
	assert.equal(preloadedFile(snapshot, "src/fixture.js").split("/* … */").length - 1, 4);
	assert.equal(preloadedFile(snapshot, "src/fixture.ts").split("/* … */").length - 1, 4);
	assert.equal(preloadedFile(snapshot, "src/fixture.py").split("...").length - 1, 3);
	assert.equal(preloadedFile(snapshot, "src/fixture.rs").split("/* … */").length - 1, 3);
	assert.equal(preloadedFile(snapshot, "src/fixture.go").split("/* … */").length - 1, 3);
});

test("reports an unsupported signature language", { timeout: 120_000 }, async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-preload-e2e-"));
	await Promise.all([
		writeFile(join(project, "AGENTS.yml"), agentsConfiguration({ signatures: ["unsupported.txt"] })),
		writeFile(join(project, "unsupported.txt"), "unsupported signature source\n"),
	]);
	const extensionErrors: string[] = [];
	const client = new RpcClient({
		cliPath,
		cwd: project,
		env: { PI_OFFLINE: "1" },
		args: ["--approve", "--no-session", "--no-extensions", "--extension", extensionPath],
	});
	client.onEvent((event) => {
		const extensionEvent = event as unknown as { type: string; error?: string };
		if (extensionEvent.type === "extension_error" && extensionEvent.error) extensionErrors.push(extensionEvent.error);
	});
	t.after(async () => {
		await client.stop();
		await rm(project, { recursive: true, force: true });
	});

	await client.start();
	await client.getMessages();
	assert.ok(extensionErrors.some((error) => error.includes("Signature folding does not support the file extension")));
	await assert.rejects(readFile(join(project, "PRELOAD.md"), "utf8"), /ENOENT/);
});

test("full selection overrides signature folding for the same path", { timeout: 120_000 }, async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-preload-e2e-"));
	const source = 'export function overlap() { return "FULL_MODE_IMPLEMENTATION"; }\n';
	await Promise.all([
		writeFile(
			join(project, "AGENTS.yml"),
			agentsConfiguration({ includes: ["overlap.js"], signatures: ["overlap.js"] }),
		),
		writeFile(join(project, "overlap.js"), source),
	]);
	const client = new RpcClient({
		cliPath,
		cwd: project,
		env: { PI_OFFLINE: "1" },
		args: ["--approve", "--no-session", "--no-extensions", "--extension", extensionPath],
	});
	t.after(async () => {
		await client.stop();
		await rm(project, { recursive: true, force: true });
	});

	await client.start();
	await client.getMessages();
	const snapshot = await readFile(join(project, "PRELOAD.md"), "utf8");
	assert.ok(snapshot.includes("FULL_MODE_IMPLEMENTATION"));
	assert.ok(!snapshot.includes("/* … */"));
	assert.equal(await readFile(join(project, "overlap.js"), "utf8"), source);
});

test("applies total context limits after signature folding", { timeout: 120_000 }, async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-preload-e2e-"));
	const sourceDirectory = join(project, "src");
	await mkdir(sourceDirectory);
	const payload = "x".repeat(220 * 1024);
	const sources = Array.from(
		{ length: 10 },
		(_, index) => `export function large${index}() { return "SOURCE_${index}_${payload}"; }\n`,
	);
	await Promise.all([
		writeFile(join(project, "AGENTS.yml"), agentsConfiguration({ signatures: ["src/*.js"] })),
		...sources.map((source, index) => writeFile(join(sourceDirectory, `large-${index}.js`), source)),
	]);
	assert.ok(sources.reduce((total, source) => total + Buffer.byteLength(source), 0) > 2 * 1024 * 1024);

	const client = new RpcClient({
		cliPath,
		cwd: project,
		env: { PI_OFFLINE: "1" },
		args: ["--approve", "--no-session", "--no-extensions", "--extension", extensionPath],
	});
	t.after(async () => {
		await client.stop();
		await rm(project, { recursive: true, force: true });
	});

	await client.start();
	await client.getMessages();
	const snapshot = await readFile(join(project, "PRELOAD.md"), "utf8");
	assert.ok(Buffer.byteLength(snapshot) < 2 * 1024 * 1024);
	assert.ok(!snapshot.includes(payload.slice(0, 1_000)));
	for (let index = 0; index < sources.length; index += 1) {
		assert.ok(snapshot.includes(`function large${index}()`));
	}
});

test("Pi does not read AGENTS.yml preload configuration for an untrusted project", { timeout: 20_000 }, async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-preload-e2e-"));
	await writeFile(join(project, "AGENTS.yml"), "pi-preload: [\n");
	const extensionErrors: string[] = [];

	const client = new RpcClient({
		cliPath,
		cwd: project,
		env: { PI_OFFLINE: "1" },
		args: ["--no-approve", "--no-session", "--no-extensions", "--extension", extensionPath],
	});
	client.onEvent((event) => {
		const extensionEvent = event as unknown as { type: string; error?: string };
		if (extensionEvent.type === "extension_error" && extensionEvent.error) {
			extensionErrors.push(extensionEvent.error);
		}
	});
	t.after(async () => {
		await client.stop();
		await rm(project, { recursive: true, force: true });
	});
	await client.start();

	const messages = await client.getMessages();
	assert.equal(
		messages.some((message) => message.role === "custom" && message.customType === "pi-preload"),
		false,
	);
	assert.deepEqual(extensionErrors, []);
	await assert.rejects(readFile(join(project, "PRELOAD.md"), "utf8"), /ENOENT/);
});
