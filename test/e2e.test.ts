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

function agentsConfiguration(configuration: unknown, otherConfiguration: Record<string, unknown> = {}) {
	return JSON.stringify({ ...otherConfiguration, "pi-preload": configuration });
}

function fileBlock(path: string, content: string) {
	const newline = content.endsWith("\n") ? "" : "\n";
	const label = JSON.stringify(path);
	return `===== BEGIN FILE ${label} =====\n${content}${newline}===== END FILE ${label} =====`;
}

test("Pi preloads valid AGENTS.yml configuration", { timeout: 20_000 }, async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-preload-e2e-"));
	await Promise.all([mkdir(join(project, "nested")), mkdir(join(project, "test"))]);
	await Promise.all([
		writeFile(
			join(project, "AGENTS.yml"),
			agentsConfiguration(
				{ files: ["nested/**/*"] },
				{
					"pi-modes": { review: "Review changes" },
					"pi-prompts": { prompts: { summarize: { body: "Summarize changes" } } },
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

test("Pi reports an invalid AGENTS.yml preload configuration", { timeout: 20_000 }, async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-preload-e2e-"));
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
	assert.ok(extensionErrors.some((error) => /AGENTS\.yml.*pi-preload/.test(error)));
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
		messages.some((message) => message.role === "custom" && message.customType === "context-preload"),
		false,
	);
	assert.deepEqual(extensionErrors, []);
	await assert.rejects(readFile(join(project, "TREE.txt"), "utf8"), /ENOENT/);
	await assert.rejects(readFile(join(project, "PRELOAD.md"), "utf8"), /ENOENT/);
});
