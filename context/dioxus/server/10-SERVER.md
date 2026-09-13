# Server Runtime

- Use `dioxus::launch` for normal serving. It supplies startup, SSR, assets, logging, and the `IP` and `PORT` bind path.
- Use `dioxus::serve` with `dioxus::server::router(app)` only to add middleware, injected state, or non-Dioxus routes. Keep custom Axum code at this outer boundary and application operations in Dioxus server functions.

