# Web Runtime

- In full-stack builds, reuse `use_loader` data during hydration. Do not repeat the initial browser request.
- Prefer Dioxus events, `MountedData`, and document components over `web_sys` or direct DOM access.
