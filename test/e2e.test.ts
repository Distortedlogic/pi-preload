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

test("Pi adds preloaded file contents and a filesystem tree to a fresh session", { timeout: 20_000 }, async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-context-preload-e2e-"));
	await Promise.all([mkdir(join(project, "nested")), mkdir(join(project, "test"))]);
	await Promise.all([
		writeFile(join(project, "CONTEXT_PRELOAD.yml"), JSON.stringify({ files: ["nested/**/*"] })),
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
	assert.deepEqual(preload.content[0], { type: "text", text: "File: nested/context.txt\n\ne2e preloaded text" });
	const tree = await readFile(join(project, "TREE.txt"), "utf8");
	assert.deepEqual(preload.content[1], { type: "text", text: `File: TREE.txt\n\n${tree}` });
	assert.match(tree, /nested/);
	assert.match(tree, /test/);
	assert.doesNotMatch(tree, /deep\.test\.ts|CONTEXT_PRELOAD\.yml|TREE\.txt|uv\.lock/);
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
			join(project, "CONTEXT_PRELOAD.yml"),
			`extends:
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
	assert.equal(preload.content.length, 3);
	const contextBlock = preload.content[0];
	assert.equal(contextBlock?.type, "text");
	if (contextBlock?.type !== "text") assert.fail("Expected Dioxus text context");
	assert.match(contextBlock.text, /^Context: dioxus\n\n/);
	assert.doesNotMatch(contextBlock.text, /Detected Dioxus Project|Workspace packages|Dioxus features/);
	assert.match(contextBlock.text, /# Dioxus Core Context/);
	assert.match(contextBlock.text, /# Full-Stack Runtime/);
	assert.match(contextBlock.text, /# Server Runtime/);
	assert.match(contextBlock.text, /# Web Runtime/);
	assert.doesNotMatch(
		contextBlock.text,
		/# Dioxus Routing|Initial Setup|Authentication|Real-Time and Streaming|PWA Integration|# Desktop|# Mobile|use_store|SetCookie|ServerEvents|CustomPaintSource|manganis::ffi/,
	);
	assert.deepEqual(preload.content[1], { type: "text", text: "File: app/src/lib.rs\n\npub fn app() {}\n" });
	const tree = await readFile(join(project, "TREE.txt"), "utf8");
	assert.deepEqual(preload.content[2], { type: "text", text: `File: TREE.txt\n\n${tree}` });
});
