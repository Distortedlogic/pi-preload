# Dioxus Core Context

Target Dioxus version: **0.7.10**.

Use current APIs from this version. Do not generate old `Scope`, `cx.render`, `use_state`, or component-context patterns.

## Reactive ownership

- Signals are copyable reactive handles. Move them into handlers and async closures without clone scaffolding.
- Read a signal with `signal()` or `.read()`. Change it with `.set()`, `.write()`, or its direct collection and assignment operations.
- Accept `ReadSignal<T>` when a child or hook must stay reactive without write access.
- Accept `WriteSignal<T>` or `Signal<T>` only when the receiver must mutate the value.
- Plain values convert into `ReadSignal<T>` props, so a component can accept both reactive and constant input.
- Use `use_memo` for derived reactive values. Use `use_effect` for effects, not duplicated derived state.
- Use `use_context_provider` for tree-scoped shared signals. Use `GlobalSignal` and `GlobalMemo` only for state that is truly application-wide.

## Async hooks

- `use_loader` is for data required by rendering. `use_loader(...)?` sends pending and failed state to Suspense and error boundaries and supports full-stack SSR transfer.
- `use_action` is for explicit work and mutations. Its handle owns `call`, `pending`, `value`, `reset`, and `cancel` state.
- `use_future` is for a component-lifetime background task without a returned UI value.
- `use_resource` is for an ordinary reactive optional result when loader or action semantics are not wanted.
- Async event handlers can return `Result`; failures propagate through Dioxus error handling.

## Components and props

- Use `#[component]` functions that return `Element`.
- Use `EventHandler<T>` for callbacks passed as props.
- `#[props(default)]`, `#[props(optional)]`, and `#[props(!optional)]` control generated prop-builder behavior. Do not assume that every `Option<T>` prop has the same builder requirement.
- Use `#[props(extends = GlobalAttributes)]` and RSX spread syntax when a wrapper component must forward element attributes.
- Use `children: Element` for component children.

## RSX

- Rust `if`, `match`, `for`, iterators, and expressions work directly in `rsx!`.
- Give mutable list entries stable keys.

## Assets and styling

- Attach CSS with `Stylesheet` and document metadata with `document::Title`, `document::Meta`, `document::Link`, and `document::Script`.

## Renderer-neutral element access

Use `MountedData` for focus, dimensions, visibility, and scrolling. Use Dioxus event data and `HasFileData` instead of direct DOM access when these APIs cover the operation.

Prefer a current Dioxus API before a lower-level browser, WebView, native, HTTP, or server-framework API.
