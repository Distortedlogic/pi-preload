# Desktop Custom Rendering

Select the highest Dioxus integration level that satisfies the host:

1. Standard Dioxus renderer.
2. Desktop child surface with `Config::with_as_child_window`.
3. Custom paint inside Dioxus Native with `dioxus_native::use_wgpu`.
4. An externally driven `DioxusDocument` when the host owns rendering and input.

## Desktop child surface

- `Config::with_on_window` receives the host window and virtual DOM before launch.
- Put host graphics resources into root context for components to consume.
- `Config::with_as_child_window` makes the Dioxus WebView a child of the host window.
- Use `use_wry_event_handler` to connect required resize or redraw events to shared graphics resources.

## Dioxus Native custom paint

- Implement `CustomPaintSource` with `resume`, `suspend`, and `render`.
- `resume` receives a `DeviceHandle`; create device-bound renderer state there.
- `render` receives `CustomPaintCtx` and returns a registered `TextureHandle`.
- Register new textures with `ctx.register_texture` and unregister replaced textures with `ctx.unregister_texture`.
- `use_wgpu` installs the paint source and gives RSX a source identifier for the `canvas` element.
- Pass small renderer updates through a typed channel instead of sharing component state with the paint implementation.

## Externally driven native document

- Construct `DioxusDocument` from a `VirtualDom` and `DocumentConfig` with a `Viewport`.
- Supply a waker that schedules the host event loop.
- Poll the document from that loop, paint its document tree, and translate host input into Dioxus `UiEvent` values.

Keep standard controls and layout in RSX; use custom paint only for the surface that requires host graphics integration.
