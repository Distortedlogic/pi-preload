# Server Initial Setup

Use this layer only when creating or enabling the backend target of a full-stack application.

Enable the server renderer through a crate feature:

```toml
[features]
server = ["dioxus/server"]
```

Make server-only dependencies optional and include their `dep:` entries in `server`.

Keep one `dioxus::launch(App)` entry point when default serving is sufficient. Use `dioxus::serve` only when startup must attach required middleware, injected state, or non-Dioxus routes.

Add the first endpoint with an HTTP verb macro:

```rust
#[get("/api/message")]
async fn get_message() -> Result<String> {
    Ok("Hello from the server".to_string())
}
```

Guard server-only imports and implementation details with `#[cfg(feature = "server")]`.
