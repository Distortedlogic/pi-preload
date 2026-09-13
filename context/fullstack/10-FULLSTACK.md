# Dioxus 0.7.10 Full-Stack Rules

Use this context for work across the Dioxus client-server boundary. Do not use this file for a client-only application.

## 1. Keep one typed Rust boundary

Share server-function signatures, request types, response types, and typed errors between client and server builds.

Keep server-only implementations, dependencies, credentials, and resources behind the `server` feature.

Do not create a duplicate TypeScript client, REST schema, or request model.

## 2. Use HTTP verb server functions

Prefer `#[get]`, `#[post]`, `#[put]`, and `#[delete]`.

Use macro paths and arguments for path values, query values, bodies, and server-only extractors. Let Dioxus generate the client operation and register normal endpoints.

Use `#[server]` only for an anonymous endpoint or a required compatibility case.

Call internal server functions directly from Rust client code. Use `reqwest` only for external services.

## 3. Match async hooks to intent

Use `use_loader` for server data required during rendering. Let `?` propagate pending and failed state to Suspense and error boundaries.

Use `use_action` for explicit commands, mutations, and user-triggered requests. Use its pending, result, reset, and cancellation state.

Do not build duplicate loading and error signals around these hooks.

## 4. Keep SSR and hydration coherent

Let Dioxus serialize loader data during server rendering and reuse it during hydration.

Do not issue a second client fetch for data already transferred by the full-stack loader path.

Keep browser-only behavior out of server rendering. Guard server-only and target-only code explicitly.

## 5. Use Dioxus full-stack transport types

Use Dioxus wrappers for forms, multipart data, headers, cookies, redirects, files, streams, server events, and WebSockets.

Do not drop to raw Axum request handling when a Dioxus type represents the same operation.

## 6. Keep state at the correct scope

Use `std::sync::LazyLock` for synchronously initialized process state. Use `dioxus::fullstack::Lazy` when initialization itself is asynchronous.

Use typed injected state only when server setup must provide a resource. Create a request extension only for request-specific state.

Do not use request extensions as a global state container.

## 7. Keep the server URL renderer-aware

Web clients normally use the current origin.

Desktop and mobile clients can require `dioxus::fullstack::set_server_url`. Supply the URL through deployment configuration.

Do not hard-code a development server URL into a release client.

## 8. Keep custom server integration narrow

Use `dioxus::launch` for normal full-stack operation.

Use `dioxus::serve` and `dioxus::server::router(app)` only for required middleware, injected state, or non-Dioxus routes.

Keep normal application operations as Dioxus server functions even when a custom router is necessary.

## 9. Use typed failures

Use Dioxus `Result<T>` for normal work. Use `HttpError` for standard HTTP failures. Use a serializable error with `AsStatusCode` when client code must distinguish variants.

Do not expose internal server details to the client.

## 10. Keep trust on the server

Validate identity, permission, input, ownership, limits, and external responses on the server.

Client state can control presentation but cannot establish authorization.

Keep secrets and trusted service calls out of web, desktop, and mobile client artifacts.
