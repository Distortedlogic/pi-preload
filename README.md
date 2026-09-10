# pi-context-preload

Load file contents into pi chat history before the first prompt. No build step.

## Install

```sh
pi install /home/entropybender/repos/pi-context-preload
```

Run `/reload`, then start a new session.

## Configure

Create `CONTEXT_PRELOAD.yml` in the session working directory:

```yaml
- "src/**/*.ts"
- "docs/**/*.md"
- "!**/*.test.ts"
```

Use a YAML list of file globs. Paths are relative to cwd. Normal fast-glob rules apply, including `!` exclusions. Hidden files need an explicit pattern such as `.github/**/*.yml`.

On session start, the extension:

- Loads only trusted projects with no existing conversation or preload entry.
- Removes duplicate matches and sorts by folder, then filename.
- Places each file under its path heading in a separate code fence. Files in each folder stay adjacent. Embedded code fences remain valid.
- Adds one visible history entry without a model call. Pi stores a custom entry and sends it to the model as a user message with the first prompt. The system prompt does not change.

Missing configuration or no matches means no action. Invalid configuration or a file read error stops the preload; no partial message is added. Existing conversations remain unchanged. Resume and `/reload` do not duplicate the preload.

Use UTF-8 text files. Content is not truncated. Keep the total size within the model context limit. **Matched contents are saved in session history and sent to the model. Do not include secrets.**

## Remove

```sh
pi remove /home/entropybender/repos/pi-context-preload
```
