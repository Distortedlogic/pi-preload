# Dioxus 0.7.10 Web Rules

Use this context only for Dioxus web targets and the web client of a Dioxus full-stack application.

## 1. Use the Dioxus web renderer

Enable the web renderer through Cargo features:

```toml
[features]
web = ["dioxus/web"]
```

Launch the application with `dioxus::launch`. Let Dioxus select the renderer from the active feature.

Use:

```sh
dx serve --platform web
```

Do not add a separate TypeScript frontend, bundler, or development server for behavior that Dioxus provides.

## 2. Keep browser UI in Rust and `rsx!`

Use Dioxus components, signals, events, routing, and document components.

Use `document::Title`, `document::Meta`, `document::Link`, and `document::Script` for document-head content.

Use `document::eval` only when a required browser library has no Dioxus or Rust interface. Do not use JavaScript as the default implementation path.

Use direct browser APIs only after you confirm that Dioxus does not expose the required operation.

## 3. Use Dioxus routing

Use a typed `Routable` enum with `Router`, `Link`, and `Outlet`.

Use typed path, query, and hash values instead of parsing URLs by hand. Use `navigator().push` and `navigator().replace` for programmatic navigation.

Use `ReadSignal<T>` for a route value when a loader, action, resource, or memo must react to route changes.

Do not use direct browser history calls for normal application navigation.

## 4. Use full-stack loaders for render data

Use `use_loader` for data that the page requires before it can render.

Use `?` to propagate pending or failed loader state. Place the page under `SuspenseBoundary` and `ErrorBoundary` where necessary.

Let full-stack rendering serialize loader data during SSR and reuse it during hydration. Do not perform a duplicate client fetch after hydration.

Use `use_action` for user-triggered requests and mutations.

## 5. Call internal server functions directly

Call generated Dioxus server functions as Rust functions.

Do not create `fetch`, `reqwest`, or JavaScript clients for the same application's server functions. Use `reqwest` in web code only for a public external service that can safely be called from the browser.

Move calls that require secrets, protected credentials, or server trust into a Dioxus server function.

## 6. Use the Dioxus asset pipeline

Declare assets with `asset!` and attach them with Dioxus document components.

```rust
const STYLE: Asset = asset!("/assets/main.css");

rsx! {
    Stylesheet { href: STYLE }
}
```

Use compiled asset paths instead of hard-coded build output paths. Do not create manual cache-busting names. Dioxus fingerprints bundled assets.

Use a custom `index.html`, manifest, or service worker only when the application specifically requires PWA or custom document behavior.

## 7. Use Tailwind for styling

Keep `tailwind.css` at the project root:

```css
@import "tailwindcss";
@source "./src/**/*.{rs,html,css}";
```

Use Tailwind classes in `rsx!`. Use conditional class values for reactive visual state.

Do not generate CSS strings in Rust. Do not add TypeScript for styling. Do not edit the generated Tailwind CSS file.

## 8. Keep web and server feature boundaries clear

Shared components, request types, response types, and server-function signatures can remain in common Rust code.

Put server-only implementations and dependencies behind:

```rust
#[cfg(feature = "server")]
```

Do not expose secrets or server-only resources to the web build.

## 9. Use web-specific code only when required

PWA files, direct JavaScript evaluation, custom HTML, and low-level browser bindings are exceptions. They are not the normal Dioxus web architecture.

Prefer Dioxus-native components and APIs first.
