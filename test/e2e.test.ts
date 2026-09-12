import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
	await mkdir(join(project, "nested"));
	await Promise.all([
		writeFile(join(project, "CONTEXT_PRELOAD.yml"), JSON.stringify({ files: ["nested/**/*"] })),
		writeFile(join(project, "nested/context.txt"), "e2e preloaded text"),
		writeFile(join(project, "nested/uv.lock"), "must not reach context"),
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
	assert.deepEqual(preload.content, [
		{ type: "text", text: "File: nested/context.txt\n\ne2e preloaded text" },
		{
			type: "text",
			text: "Filesystem tree:\n\n.\n└── nested\n    └── context.txt",
		},
	]);
});
