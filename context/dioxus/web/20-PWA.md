# Web PWA Integration

A Dioxus PWA keeps browser-addressed files in the configured public asset directory:

```text
index.html
public/
  manifest.json
  sw.js
  favicon.ico
  logo_192.png
  logo_512.png
```

- Use a custom `index.html` because service-worker registration and the manifest link must exist before the Rust application mounts.
- Account for the Dioxus deployment base path when registering the worker. The Dioxus HTML template exposes its base-path placeholder.
- Verify the built public URL. A source file under `public/` can be emitted below the Dioxus asset path.
- Keep the manifest, service worker, and icons on stable public URLs. Do not use fingerprinted `asset!` output for a URL that another static PWA file must name directly.
- Continue to use `asset!` for ordinary assets referenced from Rust.
- Keep service-worker JavaScript confined to browser PWA behavior; application state and UI remain in Dioxus Rust.
