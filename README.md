# pi-context-preload

Load selected project files into pi chat context before the first prompt. No build step. Requires Node 22.19 or later.

## Install

```sh
pi install git:git@github.com:Distortedlogic/pi-context-preload.git
```

Restart pi, then start a new conversation in the project.

## Configure

Create `CONTEXT_PRELOAD.yml` in the session working directory:

```yaml
- ".forgejo/**/*"
- "docs/**/*"
- "infra/**/*.py"
- "models/**/*"
- "services/**/*"
- ".env.example"
- "compose.yml"
- "pyproject.toml"
```

Use a YAML list of file globs, including `!` exclusions. Paths must stay inside cwd. `globby` applies the patterns and root or nested `.gitignore` files. Hidden files need an explicit pattern such as `.forgejo/**/*`. The extension does not follow directory symbolic links.

## Startup behavior

- The project must be trusted and the conversation must be empty.
- Pi replaces the editor with a progress loader. It shows file discovery, size checks, files read, bytes read, and cancellation.
- The editor returns only after preload succeeds, fails, or is cancelled.
- The final success or failure cue stays below the editor until the next input.
- Up to eight files are checked or read at once. Results remain sorted by folder, then filename.
- Each file becomes a relative path heading followed by its unchanged text in a separate code fence.
- Pi inserts one hidden user-role context entry with `display: false` and `triggerTurn: false`.
- The extension does not start a model call or change the system prompt.

Missing configuration or no matches means no action. Invalid configuration or any file error stops the complete preload. No partial context is inserted. Existing conversations, resume, and reload do not duplicate the preload. Session shutdown cancels active work.

## Limits

- 256 KiB per file, including `CONTEXT_PRELOAD.yml`.
- 1 MiB for selected contents and for final text with headings and fences.
- 1,000 selected files.
- 30 seconds for the complete preload.

Files are never truncated or silently omitted.

Use UTF-8 text files. **Matched contents are saved in session history and sent to the model. Do not include secrets.**

## Update

```sh
pi update git:git@github.com:Distortedlogic/pi-context-preload.git
```

## Remove

```sh
pi remove git:git@github.com:Distortedlogic/pi-context-preload.git
```
