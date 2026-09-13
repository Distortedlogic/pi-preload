# Web Runtime

- Reuse server-rendered `use_loader` data during hydration. Do not issue the same initial browser request again.
- Run browser-only work after mount or behind the correct target boundary.
- Use Dioxus event data, `MountedData`, and document components before `web_sys` or direct DOM code.
