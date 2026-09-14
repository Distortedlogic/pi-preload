# Full-Stack Runtime

- Prefer `#[get]`, `#[post]`, `#[put]`, and `#[delete]` with literal routes. Use `#[server]` only for anonymous or compatibility use.
- Call generated functions directly from client Rust. Use `reqwest` only for external services.
- Keep request, response, and error types shared. Put implementations and server-only extractors behind `server`; place extractors after the route.
- Use `use_loader(...)?` for render-required data and `use_action` for explicit mutations.
- Dioxus 0.7.10 `ServerFnError` is not generic. Use Dioxus `Result<T>` normally, `HttpError` for explicit HTTP failures, and `AsStatusCode` for serializable domain errors that retain their variant.

