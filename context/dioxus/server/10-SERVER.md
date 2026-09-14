# Server Runtime

- With `default-features = false`, use `dioxus::server::launch(app)`. The stock launcher owns Tokio; do not add `#[tokio::main]`, a listener, or `axum::serve`.
- The stock launcher reads `IP` and `PORT`; Dioxus 0.7.10 `ServeConfig` has no bind-address field.
- Use `dioxus::serve` with `dioxus::server::router(app)` only for required middleware, injected state, or non-Dioxus routes. Otherwise, let server functions register automatically.

