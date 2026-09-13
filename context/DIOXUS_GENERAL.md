# Dioxus 0.7.10 General Architecture Rules

1. **Treat Dioxus 0.7.10 as the source of truth**
   - Use current repository patterns instead of older Dioxus knowledge.
   - Do not generate old `Scope`, `cx.render`, `use_state`, or component-context APIs.
   - Do not copy patterns from Dioxus 0.5 or 0.6 without verification.

2. **Use a Dioxus-first architecture**
   - Start with `dioxus::launch`, `dioxus::serve`, and Dioxus full-stack APIs.
   - Do not start by building an Axum application around Dioxus.
   - Use a custom Axum router only when the application has a real non-Dioxus route, required middleware, or an unsupported extractor.
   - Use Dioxus re-exports when server framework types are necessary.

3. **Use signals as lightweight reactive handles**
   - Use `use_signal` for simple local state.
   - Signals are copyable handles. Move them into handlers and async closures directly.
   - Read with `signal()` or `.read()`.
   - Change state with `.set()`, `.write()`, or supported mutation operations.
   - Pass `ReadSignal<T>` when a child must stay reactive but must not change the value.
   - Pass `WriteSignal<T>` or `Signal<T>` only when the child must change it.
   - Do not add `Arc<Mutex<_>>`, channels, or React-style reducer code for ordinary client state.

4. **Use the Store API for structured domain state**
   - Use `#[derive(Store)]` and `use_store` when one state object has nested reactive data.
   - Use generated store lenses for fine-grained subscriptions and changes.
   - Add domain operations with `#[store] impl<Lens> Store<...>`.
   - Keep related state and behavior in the store.
   - Do not wrap every nested field in a separate signal.
   - Do not repeatedly replace a complete struct when only one nested value changed.
   - Keep `use_signal` for small state. A store is not the default for every component.

5. **Use the correct derived-state and side-effect primitives**
   - Use `use_memo` for values derived from reactive state.
   - Use `use_effect` only for external side effects.
   - Do not use an effect to copy one signal into another signal.
   - Do not maintain derived state manually when a memo can calculate it.

6. **Choose async hooks by operation type**
   - Use `use_loader` for data that rendering requires.
   - A loader can suspend through `?` and work with SSR and hydration.
   - Use `use_action` for explicit operations, mutations, and user-triggered requests.
   - Use the action state through `call`, `pending`, `value`, `reset`, and `cancel`.
   - Use `use_future` for a background task that does not produce a rendered result.
   - Use `use_resource` only when its ordinary reactive resource behavior is specifically required.
   - Do not default every asynchronous operation to `use_resource`, `spawn`, or custom loading signals.

7. **Use Suspense and error propagation**
   - Put loader-based UI under `SuspenseBoundary`.
   - Put recoverable component and asynchronous errors under `ErrorBoundary`.
   - Use `?` to propagate pending and failed states to these boundaries.
   - Do not manually reproduce loading and error state that the hook already provides.

8. **Use HTTP verb server-function macros as the default RPC layer**
   - Prefer `#[get]`, `#[post]`, `#[put]`, and `#[delete]`.
   - Use `#[server]` only for an anonymous endpoint or a required compatibility case.
   - Define path parameters, query parameters, request data, and server-only extractors through the macro contract.
   - Let Dioxus generate the client function.
   - Call that generated Rust function directly from client code.
   - Let Dioxus register normal server functions automatically.
   - Do not create a matching `reqwest` client for an internal server function.
   - Use `reqwest` for external services, not for communication inside the same Dioxus application.

9. **Use Dioxus-native server errors and responses**
   - Return Dioxus `Result<T>` for normal server-function work.
   - Use `HttpError` for standard HTTP failures.
   - Use a serializable typed error with `AsStatusCode` when client code must distinguish error variants.
   - Use Dioxus full-stack request and response types before direct Axum types.
   - Keep server-only implementation code behind the `server` feature.

10. **Use a strict server-state selection order**
    1. Use `std::sync::LazyLock<T>` for process-wide state with synchronous initialization.
    2. Put an async-compatible lock inside the `LazyLock` when shared state needs asynchronous mutation.
    3. Use `dioxus::fullstack::Lazy<T>` when initialization itself is asynchronous, such as database pool creation.
    4. Use typed application state only when a server function needs injected server state.
    5. Create a request extension only when a resource is genuinely specific to a request.

    Do not use Axum extensions as the default place for global state. Do not build a custom router only to hold a database or shared collection.

11. **Use the typed Dioxus WebSocket API**
    - Define serializable client-event and server-event enums.
    - Use `use_websocket` for the client connection.
    - Return `Websocket<ClientEvent, ServerEvent>` from a server function.
    - Accept `WebSocketOptions` and use `on_upgrade` for server processing.
    - Use Dioxus `send`, `recv`, connection status, reconnection behavior, and built-in encodings.
    - Do not use raw Axum WebSocket extraction.
    - Do not create a manual JSON protocol when typed events are sufficient.

12. **Use the Dioxus asset pipeline**
    - Declare bundled assets with `asset!`.
    - Store reused assets in `Asset` constants.
    - Use `Stylesheet` or the appropriate `document::*` component to attach them.
    - Use project-rooted asset paths.
    - Do not create a static-file endpoint for normal bundled assets.
    - Do not use runtime filesystem loading for assets known at build time.

13. **Use Tailwind as the application styling system**
    - Put a `tailwind.css` file at the project root.
    - Let the Dioxus 0.7 CLI start and manage the Tailwind watcher.
    - Include Rust source in Tailwind scanning:

      ```css
      @import "tailwindcss";
      @source "./src/**/*.{rs,html,css}";
      ```

    - Put styling in Tailwind classes or CSS assets.
    - Rust can select classes based on reactive state.
    - Do not generate CSS in Rust.
    - Do not add TypeScript to manage styling.
    - Do not edit generated Tailwind output.

14. **Keep one Rust full-stack model**
    - Share request types, response types, errors, and server-function signatures between client and server.
    - Use Cargo features such as `web`, `desktop`, `mobile`, and `server` for platform separation.
    - Use `#[cfg(feature = "server")]` for server-only dependencies and implementations.
    - Do not create a separate TypeScript frontend for behavior that Dioxus already supports.

15. **Treat lower-level frameworks as exceptions**
    - First check for a Dioxus hook, component, server-function type, stream type, asset API, or server API.
    - Use direct Axum, JavaScript, manual HTTP, or custom runtime integration only when Dioxus has no suitable native operation.
    - The presence of a specialized example does not make its lower-level approach the general default.
