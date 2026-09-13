# Dioxus Core Context

- Use Dioxus 0.7.10 APIs. Do not use old `Scope`, `cx.render`, `use_state`, or component-context APIs.
- Treat signals as copyable reactive handles. Move them into handlers and async closures without clone scaffolding.
- Accept `ReadSignal<T>` for reactive read access. Accept `WriteSignal<T>` or `Signal<T>` only when the receiver must mutate the value.
- Use `use_loader(...)?` for data that rendering requires.
- Use `use_action` for explicit operations and mutations.
- Use a lower-level platform API only when Dioxus has no suitable operation.
