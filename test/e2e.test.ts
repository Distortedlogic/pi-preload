import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { RpcClient } from "@earendil-works/pi-coding-agent";

const extensionPath = fileURLToPath(new URL("../index.ts", import.meta.url));
const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const cliPath = join(dirname(codingAgentEntry), "cli.js");

function agentsConfiguration(configuration: unknown, unrelated: Record<string, unknown> = {}) {
	return JSON.stringify({
		...unrelated,
		pi: { extensions: { "pi-context-preload": configuration } },
	});
}

function fileBlock(path: string, content: string) {
	const newline = content.endsWith("\n") ? "" : "\n";
	const label = JSON.stringify(path);
	return `===== BEGIN FILE ${label} =====\n${content}${newline}===== END FILE ${label} =====`;
}

test("Pi preloads valid AGENTS.yml configuration", { timeout: 20_000 }, async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-context-preload-e2e-"));
	await Promise.all([mkdir(join(project, "nested")), mkdir(join(project, "test"))]);
	await Promise.all([
		writeFile(
			join(project, "AGENTS.yml"),
			agentsConfiguration(
				{ files: ["nested/**/*"] },
				{
					modes: { review: "Review changes" },
					prompts: { summarize: "Summarize changes" },
				},
			),
		),
		writeFile(join(project, "nested/context.txt"), "e2e preloaded text"),
		writeFile(join(project, "nested/uv.lock"), "must not reach context"),
		writeFile(join(project, "test/deep.test.ts"), "must stay out of the tree"),
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

	const messages = await client.getMessages();
	const preload = messages.find((message) => message.role === "custom" && message.customType === "context-preload");

	assert.ok(preload);
	if (preload.role !== "custom") assert.fail("Expected a custom preload message");
	assert.equal(preload.display, false);
	assert.ok(Array.isArray(preload.content));
	assert.equal(preload.content.length, 1);
	assert.deepEqual(preload.content[0], { type: "text", text: fileBlock("nested/context.txt", "e2e preloaded text") });
	assert.equal(
		await readFile(join(project, "PRELOAD.md"), "utf8"),
		`${fileBlock("nested/context.txt", "e2e preloaded text")}\n`,
	);
	await assert.rejects(readFile(join(project, "TREE.txt"), "utf8"), /ENOENT/);
});

test("Pi ignores a missing pi.extensions.pi-context-preload configuration", { timeout: 20_000 }, async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-context-preload-e2e-"));
	await writeFile(join(project, "AGENTS.yml"), JSON.stringify({ modes: { review: "Review changes" } }));

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

	const messages = await client.getMessages();
	assert.equal(
		messages.some((message) => message.role === "custom" && message.customType === "context-preload"),
		false,
	);
	await assert.rejects(readFile(join(project, "TREE.txt"), "utf8"), /ENOENT/);
	await assert.rejects(readFile(join(project, "PRELOAD.md"), "utf8"), /ENOENT/);
});

test("Pi reports an invalid AGENTS.yml preload configuration", { timeout: 20_000 }, async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-context-preload-e2e-"));
	await writeFile(join(project, "AGENTS.yml"), agentsConfiguration({ files: [42] }));
	const extensionErrors: string[] = [];

	const client = new RpcClient({
		cliPath,
		cwd: project,
		env: { PI_OFFLINE: "1" },
		args: ["--approve", "--no-session", "--no-extensions", "--extension", extensionPath],
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
		messages.some((message) => message.role === "custom" && message.customType === "context-preload"),
		false,
	);
	assert.ok(extensionErrors.some((error) => /AGENTS\.yml.*pi\.extensions\.pi-context-preload/.test(error)));
});

for (const [name, source] of [
	["malformed YAML", "pi: [\n"],
	["an unknown owned-section field", agentsConfiguration({ files: [], unknown: true })],
] as const) {
	test(`Pi reports ${name} with its source and section path`, { timeout: 20_000 }, async (t) => {
		const project = await mkdtemp(join(tmpdir(), "pi-context-preload-e2e-"));
		await writeFile(join(project, "AGENTS.yml"), source);
		let resolveExtensionError: (error: string) => void;
		const extensionError = new Promise<string>((resolve) => {
			resolveExtensionError = resolve;
		});

		const client = new RpcClient({
			cliPath,
			cwd: project,
			env: { PI_OFFLINE: "1" },
			args: ["--approve", "--no-session", "--no-extensions", "--extension", extensionPath],
		});
		client.onEvent((event) => {
			const extensionEvent = event as unknown as { type: string; error?: string };
			if (extensionEvent.type === "extension_error" && extensionEvent.error) {
				resolveExtensionError(extensionEvent.error);
			}
		});
		t.after(async () => {
			await client.stop();
			await rm(project, { recursive: true, force: true });
		});
		await client.start();

		assert.match(await extensionError, /AGENTS\.yml.*pi\.extensions\.pi-context-preload/);
	});
}

test("Pi does not read AGENTS.yml preload configuration for an untrusted project", { timeout: 20_000 }, async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-context-preload-e2e-"));
	await writeFile(join(project, "AGENTS.yml"), "preload: [\n");
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
		messages.some((message) => message.role === "custom" && message.customType === "context-preload"),
		false,
	);
	assert.deepEqual(extensionErrors, []);
	await assert.rejects(readFile(join(project, "TREE.txt"), "utf8"), /ENOENT/);
	await assert.rejects(readFile(join(project, "PRELOAD.md"), "utf8"), /ENOENT/);
});

test("Pi preloads detected Dioxus context from an offline local workspace", { timeout: 30_000 }, async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-context-preload-e2e-"));
	const app = join(project, "app");
	const unrelated = join(project, "unrelated");
	const dioxus = join(project, "vendor", "dioxus");
	await Promise.all([
		mkdir(join(app, "src"), { recursive: true }),
		mkdir(join(unrelated, "src"), { recursive: true }),
		mkdir(join(dioxus, "src"), { recursive: true }),
	]);
	await Promise.all([
		writeFile(
			join(project, "Cargo.toml"),
			`[workspace]
members = ["app", "unrelated"]
default-members = ["app"]
exclude = ["vendor/dioxus"]
resolver = "2"

[workspace.dependencies]
dioxus = { version = "0.7.10", path = "vendor/dioxus", default-features = false }
`,
		),
		writeFile(
			join(app, "Cargo.toml"),
			`[package]
name = "fixture-app"
version = "0.1.0"
edition = "2021"

[dependencies]
dioxus = { workspace = true }

[features]
default = ["application"]
application = ["web-target", "server-target"]
web-target = ["dioxus/web"]
server-target = ["dioxus/server", "dioxus/fullstack"]
`,
		),
		writeFile(join(app, "src", "lib.rs"), "pub fn app() {}\n"),
		writeFile(
			join(unrelated, "Cargo.toml"),
			`[package]
name = "unrelated-app"
version = "0.1.0"
edition = "2021"

[dependencies]
dioxus = { workspace = true, features = ["desktop", "mobile"] }
`,
		),
		writeFile(join(unrelated, "src", "lib.rs"), "pub fn unrelated() {}\n"),
		writeFile(
			join(dioxus, "Cargo.toml"),
			`[package]
name = "dioxus"
version = "0.7.10"
edition = "2021"

[features]
default = []
web = []
server = []
fullstack = []
desktop = []
mobile = []
native = []
router = []
`,
		),
		writeFile(join(dioxus, "src", "lib.rs"), "pub fn launch() {}\n"),
		writeFile(
			join(project, "AGENTS.yml"),
			`pi:
  extensions:
    pi-context-preload:
      extends:
        - "dioxus-rust"
      files:
        - "app/src/lib.rs"
`,
		),
	]);

	const client = new RpcClient({
		cliPath,
		cwd: project,
		env: { PI_OFFLINE: "1", CARGO_NET_OFFLINE: "true" },
		args: ["--approve", "--no-session", "--no-extensions", "--extension", extensionPath],
	});
	t.after(async () => {
		await client.stop();
		await rm(project, { recursive: true, force: true });
	});
	await client.start();

	const messages = await client.getMessages();
	const preload = messages.find((message) => message.role === "custom" && message.customType === "context-preload");

	assert.ok(preload);
	if (preload.role !== "custom") assert.fail("Expected a custom preload message");
	assert.equal(preload.display, false);
	assert.ok(Array.isArray(preload.content));
	assert.equal(preload.content.length, 2);
	const contextBlock = preload.content[0];
	assert.equal(contextBlock?.type, "text");
	if (contextBlock?.type !== "text") assert.fail("Expected Dioxus text context");
	assert.match(contextBlock.text, /^Context: dioxus\n\n/);
	assert.doesNotMatch(contextBlock.text, /^(?:Detected Dioxus Project|Workspace packages|Dioxus features)/m);
	assert.match(contextBlock.text, /# Dioxus Core/);
	assert.match(contextBlock.text, /# Full-Stack Runtime/);
	assert.match(contextBlock.text, /# Server Runtime/);
	assert.match(contextBlock.text, /# Web Runtime/);
	assert.doesNotMatch(
		contextBlock.text,
		/# Dioxus Routing|Initial Setup|Authentication|Real-Time and Streaming|PWA Integration|# Desktop|# Mobile|use_store|SetCookie|ServerEvents|CustomPaintSource|manganis::ffi/,
	);
	assert.deepEqual(preload.content[1], { type: "text", text: fileBlock("app/src/lib.rs", "pub fn app() {}\n") });
	await assert.rejects(readFile(join(project, "TREE.txt"), "utf8"), /ENOENT/);
});
