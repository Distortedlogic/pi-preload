import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext, SessionStartEvent } from "@earendil-works/pi-coding-agent";
import extension, { collectPreload } from "../index.ts";

type SessionStartHandler = (event: SessionStartEvent, ctx: ExtensionContext) => Promise<void> | void;
type NoticeType = "info" | "warning" | "error" | undefined;

test("collects contents from cwd, parent, and absolute globs", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-context-preload-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const project = join(root, "project");
	const absoluteFile = join(root, "absolute.txt");
	await mkdir(project);
	await Promise.all([
		writeFile(join(project, "inside.txt"), "inside"),
		writeFile(join(root, "parent.txt"), "parent"),
		writeFile(absoluteFile, "absolute"),
		writeFile(join(project, "CONTEXT_PRELOAD.yml"), JSON.stringify(["inside.txt", "../parent.txt", absoluteFile])),
	]);

	const result = await collectPreload(project, AbortSignal.timeout(5_000));

	assert.ok(result);
	assert.equal(result.count, 3);
	assert.equal(result.bytes, Buffer.byteLength("insideparentabsolute"));
	const text = result.blocks.map((block) => block.text);
	assert.ok(text.includes("File: inside.txt\n\ninside"));
	assert.ok(text.includes("File: ../parent.txt\n\nparent"));
	assert.ok(text.includes(`File: ${absoluteFile}\n\nabsolute`));
});

test("session_start sends collected file blocks without starting a turn", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-context-preload-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	await Promise.all([
		writeFile(join(root, "CONTEXT_PRELOAD.yml"), JSON.stringify(["context.txt"])),
		writeFile(join(root, "context.txt"), "preloaded text"),
	]);

	let handler: SessionStartHandler | undefined;
	const sent: Parameters<ExtensionAPI["sendMessage"]>[] = [];
	const statuses: Array<[string, string | undefined]> = [];
	const notices: Array<[string, NoticeType]> = [];
	const pi = {
		on(event: string, callback: unknown) {
			if (event === "session_start") handler = callback as SessionStartHandler;
		},
		sendMessage(...args: Parameters<ExtensionAPI["sendMessage"]>) {
			sent.push(args);
		},
	} as unknown as ExtensionAPI;
	extension(pi);
	assert.ok(handler);

	await handler({ type: "session_start", reason: "startup" }, {
		cwd: root,
		isProjectTrusted: () => true,
		sessionManager: { buildContextEntries: () => [] },
		ui: {
			setStatus: (key: string, value: string | undefined) => statuses.push([key, value]),
			notify: (message: string, type?: NoticeType) => notices.push([message, type]),
		},
	} as unknown as ExtensionContext);

	assert.equal(sent.length, 1);
	const [message, options] = sent[0];
	assert.equal(message.customType, "context-preload");
	assert.equal(message.display, false);
	assert.deepEqual(options, { triggerTurn: false });
	assert.ok(Array.isArray(message.content));
	assert.equal(message.content[0]?.type, "text");
	assert.equal(message.content[0]?.text, "File: context.txt\n\npreloaded text");
	assert.deepEqual(statuses, [
		["context-preload", "Preloading context..."],
		["context-preload", undefined],
	]);
	assert.ok(notices.some(([message, type]) => type === "info" && message.startsWith("Context preloaded: 1 file")));
});

test("session_start reports and propagates preload errors", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-context-preload-"));
	t.after(async () => rm(root, { recursive: true, force: true }));
	await writeFile(join(root, "CONTEXT_PRELOAD.yml"), JSON.stringify([42]));

	let handler: SessionStartHandler | undefined;
	const sent: Parameters<ExtensionAPI["sendMessage"]>[] = [];
	const statuses: Array<[string, string | undefined]> = [];
	const notices: Array<[string, NoticeType]> = [];
	const pi = {
		on(event: string, callback: unknown) {
			if (event === "session_start") handler = callback as SessionStartHandler;
		},
		sendMessage(...args: Parameters<ExtensionAPI["sendMessage"]>) {
			sent.push(args);
		},
	} as unknown as ExtensionAPI;
	extension(pi);
	const sessionStart = handler;
	assert.ok(sessionStart);

	await assert.rejects(async () => {
		await sessionStart({ type: "session_start", reason: "startup" }, {
			cwd: root,
			isProjectTrusted: () => true,
			sessionManager: { buildContextEntries: () => [] },
			ui: {
				setStatus: (key: string, value: string | undefined) => statuses.push([key, value]),
				notify: (message: string, type?: NoticeType) => notices.push([message, type]),
			},
		} as unknown as ExtensionContext);
	});

	assert.equal(sent.length, 0);
	assert.deepEqual(statuses, [
		["context-preload", "Preloading context..."],
		["context-preload", undefined],
	]);
	assert.ok(notices.some(([message, type]) => type === "error" && message.startsWith("Context preload failed:")));
});
