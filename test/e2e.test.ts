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

test("Pi adds preloaded file contents to a fresh session", { timeout: 20_000 }, async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-context-preload-e2e-"));
	const agentDir = join(project, "agent");
	await Promise.all([mkdir(join(project, "nested")), mkdir(join(agentDir, "context-preload"), { recursive: true })]);
	await Promise.all([
		writeFile(join(project, "CONTEXT_PRELOAD.yml"), JSON.stringify({ extends: ["common"] })),
		writeFile(join(agentDir, "context-preload/common.yml"), JSON.stringify(["nested/**/*"])),
		writeFile(join(project, "nested/context.txt"), "e2e preloaded text"),
		writeFile(join(project, "nested/uv.lock"), "must not reach context"),
	]);

	const client = new RpcClient({
		cliPath,
		cwd: project,
		env: { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" },
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
	assert.deepEqual(preload.content, [{ type: "text", text: "File: nested/context.txt\n\ne2e preloaded text" }]);
});
