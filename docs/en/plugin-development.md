# Plugin development


[中文](../plugin-development.md) · English

Plugins extend OneTHU through the host permission facade; start with the [generated type surface](api-surface.md) and [developer setup](developers.md). Extensions can be packaged as portable JavaScript plugins, native Rust sidecars on desktop, or embedded native modules on Android, each matching the capabilities of its target platform.

Request only the permissions your plugin genuinely needs—the host enforces permission checks on every API call at runtime. Build plugin views with OneGUI components and central theme tokens, and register custom content through the shared atom, navigation, widget, and staging adapters so everything integrates cleanly with the rest of the workspace.

OneTHU Harness lives in its own agent submodule and exposes authorized tools to OH. Xiaoda plaza skills bundle prompts and scripts alongside their runtime requirements: self-contained synchronous JavaScript runs inside the built-in QuickJS engine (with no filesystem, network, or subprocess access), while skills that need Python or Node export to an external desktop agent environment. See [execution boundaries](oh-and-xiaoda.md).

Test plugins with fictional fixture data, verify clean teardown and multi-account isolation, and check layouts on mobile viewports. Keep credentials and personal campus responses out of logs and external uploads. Extensive code examples are maintained in the Chinese [detailed plugin reference](../plugin-development.md), sharing identical API method names and signatures across the 41 namespaces and 297 methods in the generated reference.
