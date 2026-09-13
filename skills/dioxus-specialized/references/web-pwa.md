# Web PWA integration

Put browser-addressed PWA files in the configured public asset directory. Keep the manifest, service worker, and icons at stable public URLs.

Use a custom `index.html` when the manifest link and service-worker registration must exist before the Rust application mounts. Account for the Dioxus deployment base path when you register the worker. Use the base-path placeholder from the Dioxus HTML template.

Verify the built public URL for each file. A source file under `public/` can be emitted below the configured Dioxus asset path.

Do not use fingerprinted `asset!` output for a URL that the manifest, service worker, or another static file must name. Continue to use `asset!` for ordinary assets referenced from Rust.
