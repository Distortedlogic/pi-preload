# Dioxus Core

- Use Dioxus 0.7.10. Never use `Scope`, `cx.render`, `use_state`, or legacy component-context APIs.
- Signals are copyable handles. Use `ReadSignal<T>` for reads and `WriteSignal<T>` or `Signal<T>` for writes; move them into closures without cloning.
- In project Cargo manifests, set Dioxus features only from `web`, `desktop`, `mobile`, `fullstack`, `server`, and `router`. Adapt the code instead of adding any other Dioxus feature.
