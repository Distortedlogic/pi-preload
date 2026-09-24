import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { RpcClient } from "@earendil-works/pi-coding-agent";

const extensionPath = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const codingAgentEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const cliPath = join(dirname(codingAgentEntry), "cli.js");

function agentsConfiguration(configuration: unknown) {
	return JSON.stringify({ "other-extension": { enabled: true }, "pi-preload": configuration });
}

test("trusted Pi keeps one hidden generated-context message across reload", { timeout: 20_000 }, async (t) => {
	const project = await mkdtemp(join(tmpdir(), "pi-preload-e2e-"));
	const reloadExtensionPath = join(project, "reload-extension.ts");
	await Promise.all([
		writeFile(join(project, "AGENTS.yml"), agentsConfiguration({})),
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
		assert.deepEqual(preload.content, []);
		assert.equal(await readFile(join(project, "PRELOAD.md"), "utf8"), "\n");
	};

	await assertSinglePreload();
	await client.prompt("/reload-preload");
	await assertSinglePreload();
});
