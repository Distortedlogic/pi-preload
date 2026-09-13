# Dioxus 0.7.10 Custom Rendering Rules

Use this context only when Dioxus must render into a custom WGPU texture, native renderer, child surface, or externally managed event loop.

Do not use this context for a normal web, desktop, or mobile application.

## 1. Confirm that the standard renderer is insufficient

Use `dioxus/web`, `dioxus/desktop`, `dioxus/mobile`, or `dioxus/native` when one of them meets the requirement.

Use custom rendering only when Dioxus UI must be embedded into another renderer or when the host application must own the graphics and event loops.

Do not build a custom renderer to change ordinary application styling or window configuration.

## 2. Select one integration level

Use the highest-level integration that works:

1. Use the standard Dioxus renderer.
2. Use a Dioxus child window or surface inside an existing application.
3. Use `dioxus_native::use_wgpu` for custom paint content inside Dioxus Native.
4. Drive `DioxusDocument` from an external loop only when the host must own all rendering and input.

Do not combine these approaches without a specific architecture requirement.

## 3. Reuse the host WGPU resources

Use the existing WGPU device and queue when Dioxus content shares a renderer with the host.

Create expensive renderer and pipeline objects once per device. Do not recreate them each frame.

Request only required WGPU features and limits. Keep those requirements explicit at application startup.

## 4. Implement renderer lifecycle correctly

A custom paint source must support device lifecycle events.

Create device-bound resources during resume. Release or mark them unavailable during suspend. Recreate textures after size or device changes.

Do not keep stale textures, views, pipelines, or device handles after suspension or device loss.

## 5. Manage textures through Dioxus

Register textures through the Dioxus rendering context. Unregister replaced textures.

Keep the displayed texture valid while the next frame renders. Swap displayed and next textures only after submission.

Return `None` for zero-sized surfaces. Do not create zero-width or zero-height textures.

## 6. Keep custom paint communication typed and small

Send renderer changes through a small typed message enum, such as a color or resource update.

Process pending messages before a frame. Do not share broad mutable application state directly with the graphics renderer.

Use Dioxus signals and memos for application state. Convert only the values needed by custom paint code.

## 7. Forward host events into Dioxus

When the host owns the event loop, provide Dioxus with:

- viewport width and height
- scale factor
- color scheme
- mouse and pointer events
- keyboard events
- focus changes
- resize events
- a waker that schedules the next host poll

Translate coordinates and modifiers consistently. Do not send raw host events without adapting them to Dioxus event types.

## 8. Poll and paint in the host frame lifecycle

Poll the virtual DOM or native document when its waker requests work and before painting a new UI frame.

Run layout with the current viewport. Build the paint scene and submit it through the host renderer.

Do not poll continuously when no UI work or animation requires another frame.

## 9. Preserve layer and alpha behavior

Select texture formats and alpha modes that match host composition.

Use transparent clearing only when the Dioxus layer must blend with host content. Keep z-order and hit-testing rules explicit for content above and below the custom surface.

Do not assume that WebView transparency and native-renderer transparency behave the same way.

## 10. Handle resize and device errors

Reconfigure surfaces and recreate size-dependent resources after resize.

Handle surface acquisition, device loss, and out-of-memory failures explicitly. Do not unwrap recoverable per-frame graphics results in production code.

## 11. Keep normal UI in Dioxus

Use `rsx!`, components, signals, stores, and Tailwind or CSS for normal controls and layout.

Use custom paint only for graphics that require GPU rendering. Do not replace buttons, forms, text, and standard layout with hand-built WGPU code.

## 12. Test lifecycle boundaries

Test:

- initial device creation
- suspend and resume
- resize, including zero size
- scale-factor changes
- texture replacement and cleanup
- input coordinate mapping
- device or surface recovery
- application shutdown

Custom rendering is a specialized integration. Keep it isolated from ordinary Dioxus application architecture.
