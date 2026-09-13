# Dioxus 0.7.10 PWA Rules

Use this context only when a Dioxus web application must install as a Progressive Web App or work offline.

## 1. Keep the application as a normal Dioxus web app

Use Dioxus components, routing, signals, loaders, actions, assets, and Tailwind for application code.

Add PWA files only for browser platform requirements. Do not move application behavior into the service worker.

## 2. Add only the required PWA files

A typical PWA addition is:

```text
index.html
public/
  manifest.json
  sw.js
  favicon.ico
  logo_192.png
  logo_512.png
```

Use the repository's configured public asset directory. Do not duplicate the same asset in multiple source directories.

## 3. Register the service worker from the web document

Use a custom `index.html` only when service-worker or manifest registration requires it.

Register the worker after you test the final Dioxus public asset path and base path:

```html
<script>
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/assets/sw.js");
  }
</script>
<link rel="manifest" href="/assets/manifest.json" />
```

Do not assume that a development path is correct for a deployed subpath. Keep service-worker scope and the Dioxus base path consistent.

## 4. Define a complete web manifest

Set these values explicitly:

- application name and short name
- start URL and scope
- display mode
- theme and background colors
- icon paths, types, and sizes
- application description

Use real PNG icons at the declared sizes. Do not point all declared icon sizes to an unrelated image.

## 5. Use explicit cache versions

Give each service-worker cache generation a version. Delete old cache generations during activation.

Change the version when cache behavior or required offline assets change.

Do not keep obsolete application bundles indefinitely.

## 6. Select a cache policy by resource type

Use an explicit policy for each class of resource:

- cache-first for immutable fingerprinted assets
- network-first for HTML and data that must stay current
- stale-while-revalidate for content where temporary stale data is acceptable
- network-only for sensitive or non-cacheable requests

Do not apply one broad cache rule to all GET requests without reviewing authentication, API data, HTML updates, and storage growth.

## 7. Do not cache sensitive data by default

Do not cache authenticated API responses, private user data, session endpoints, mutation responses, or secrets unless the product has an explicit secure offline design.

Do not cache non-GET requests.

Check request origin before caching third-party responses.

## 8. Provide an intentional offline result

Choose the required offline behavior before implementation. It can be:

- a cached application shell
- a dedicated offline page
- cached read-only content
- a clear unavailable response

Do not report successful offline support when only the static shell loads and all required data fails.

## 9. Keep Dioxus assets and worker assets distinct

Use `asset!` for normal application assets referenced from Rust.

Keep files that the browser must address by stable PWA paths in the configured public directory when fingerprinting would break manifest or service-worker references.

Verify final output paths instead of relying on source paths.

## 10. Keep Tailwind in the normal build flow

Use the root `tailwind.css` source and Dioxus Tailwind watcher. Cache only the generated production asset.

Do not edit generated Tailwind output. Do not make the service worker generate or transform CSS.

## 11. Test production behavior

Test a production build over HTTPS or localhost. Confirm:

- the manifest loads without errors
- the service worker registers under the intended scope
- installability checks pass
- icons load at their declared paths
- a new deployment replaces old cached code
- offline behavior matches the requirement
- authenticated data is not cached accidentally

Do not judge PWA behavior only through the Dioxus development server and an already populated browser cache.
