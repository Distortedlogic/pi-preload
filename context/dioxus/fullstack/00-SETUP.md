# Full-Stack Initial Setup

Use this layer only when creating or enabling a full-stack application.

Enable `dioxus/fullstack`, one or more client renderers, and the server renderer:

```toml
[features]
default = ["web"]
web = ["dioxus/web"]
desktop = ["dioxus/desktop"]
mobile = ["dioxus/mobile"]
server = ["dioxus/server"]
```

Keep one shared `dioxus::launch(App)` entry point.

Add the first generated client-server operation with an HTTP verb macro:

```rust
#[get("/api/greeting/{name}")]
async fn greeting(name: String) -> Result<String> {
    Ok(format!("Hello, {name}"))
}
```

Keep shared request and response types visible to both builds. Guard server-only dependencies and implementation details with `#[cfg(feature = "server")]`.

Web clients normally use the current origin. Configure `dioxus::fullstack::set_server_url` for desktop or mobile deployments that use a remote server.
