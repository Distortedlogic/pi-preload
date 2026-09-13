# Web Runtime

- `dioxus/web` is selected by the active Cargo feature; `dioxus::launch` chooses the renderer.
- A full-stack web client normally calls generated server functions on the current origin. Do not set a remote server URL unless deployment requires another origin.
- Server-rendered `use_loader` data is transferred into hydration. Do not issue the same initial browser request again.
- Keep browser-only operations out of server rendering. Run required browser effects after mount or behind the correct target boundary.
- Use `document::eval` only for a browser library that has no Dioxus or Rust interface. Its `send` and `recv` operations provide the Rust-JavaScript message channel.
- Use Dioxus event data, `MountedData`, and document components before `web_sys` or direct DOM code.
- A custom `index.html` is an exception for behavior that document components cannot express.
