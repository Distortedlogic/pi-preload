# Web Runtime

- Server-rendered `use_loader` data is transferred into hydration. Do not issue the same initial browser request again.
- Keep browser-only operations out of server rendering. Run required browser effects after mount or behind the correct target boundary.
- Use Dioxus event data, `MountedData`, and document components before `web_sys` or direct DOM code.
