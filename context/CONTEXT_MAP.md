# Dioxus Context Load Map

Use this map to select the smallest context set for a task. Do not preload every Dioxus context file.

## Load order

Load selected files in this order:

1. `context/CORE.md`
2. The active feature's `00-SETUP.md` only for setup, migration, or target-addition work
3. The active feature's `10-*.md` rules
4. A specialized `20-*.md` or `30-*.md` file only when the task requires it

The existing repository and the user's instructions take priority over these files. A more specialized context file takes priority over a general file when their guidance differs.

## Base selection

| Task | Load |
|---|---|
| Any Dioxus task | `context/CORE.md` |
| Create or configure a web target | `context/web/00-SETUP.md`, `context/web/10-WEB.md` |
| Work on an existing web target | `context/web/10-WEB.md` |
| Create or configure a desktop target | `context/desktop/00-SETUP.md`, `context/desktop/10-DESKTOP.md` |
| Work on an existing desktop target | `context/desktop/10-DESKTOP.md` |
| Create or configure a mobile target | `context/mobile/00-SETUP.md`, `context/mobile/10-MOBILE.md` |
| Work on an existing mobile target | `context/mobile/10-MOBILE.md` |
| Create or configure the server target | `context/server/00-SETUP.md`, `context/server/10-SERVER.md` |
| Work on an existing server target | `context/server/10-SERVER.md` |
| Create or configure a full-stack application | `context/fullstack/00-SETUP.md`, `context/fullstack/10-FULLSTACK.md` |
| Work on an existing full-stack boundary | `context/fullstack/10-FULLSTACK.md` |

## Composed applications

Load each active layer, but load setup files only when setup changes:

| Application | Runtime context |
|---|---|
| Client-only web | core + web |
| Full-stack web | core + web + full-stack + server |
| Local desktop | core + desktop |
| Desktop with remote server functions | core + desktop + full-stack + server |
| Mobile with remote server functions | core + mobile + full-stack + server |
| Server-rendered application | core + full-stack + server |

## Specialized selection

| Trigger | Add |
|---|---|
| PWA, service worker, installability, or offline web behavior | `context/web/20-PWA.md` |
| Custom WGPU surface, custom renderer, child surface, or external event loop | `context/desktop/20-CUSTOM-RENDERING.md` |
| Swift, Kotlin, Manganis FFI, or a native mobile plug-in | `context/mobile/20-NATIVE-PLUGIN.md` |
| Login, sessions, cookies, identity, roles, or permissions | `context/fullstack/20-AUTH.md` |
| WebSockets, SSE, typed streams, or streamed file transfer | `context/fullstack/30-REALTIME-STREAMING.md` |

## Exclusions

Do not load:

- any `00-SETUP.md` file for ordinary work in an established target
- PWA context for a normal web application
- custom-rendering context for a normal desktop application
- native-plug-in context when Dioxus or a Rust package already supplies the capability
- authentication context for public endpoints without identity or permission work
- real-time context for ordinary request-response server functions
- contexts for inactive renderers

Select context from the actual task, active Cargo features, and repository structure. Do not select files only because they exist.
