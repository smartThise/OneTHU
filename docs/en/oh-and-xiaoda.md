# Search, OH, Harness and Xiaoda


[中文](../oh-and-xiaoda.md) · English

## Different entry points

Search finds built-in features, settings, and campus items and jumps straight to the matching view. It runs locally in every experience mode with instant results, independent of any language model.

OH is OneTHU's conversational assistant. In Full mode, OneTHU Harness can call authorized host tools and installed plugins; in Minimal and Practical modes, OH keeps your configured model API and WeChat/Feishu links working while hiding Full-mode extension panels. Interactive guide buttons open the live Search bar, OH panel, or relevant mode and plugin settings directly.

Xiaoda connects to Tsinghua's campus AI service—including school models, agents, and the skill plaza—with its own campus sign-in, availability, and usage quotas separate from external API providers. If you hit `429` rate limits or timeouts, check the selected model, account status, and error message before retrying so concurrent retries do not pile up, and wait for a turn to finish streaming to confirm the complete reply arrived.

## Skills

From the skill plaza, you can browse community skills, inspect their source files and runtime needs, and import them into your account-scoped local library, where newly imported skills stay disabled until you turn them on.

For lightweight synchronous JavaScript, OneTHU includes an embedded QuickJS engine on both desktop and Android—bounded to 2 seconds, 32 MiB of memory, a 256 KiB stack, and 64 KiB of code and I/O—designed for self-contained pure computation.

Skills that rely on Python or Node packages, filesystem or network access, native CLI tools, browsers, or long-running processes can be exported to a folder on desktop or a ZIP archive on Android, ready for you to install their dependencies and run them in an external desktop agent.

## Plugins, MCP and privacy

The host's [generated plugin surface](api-surface.md) spans 36 namespaces and 255 methods, each governed by platform support and runtime permission checks—for example, native Rust sidecars target desktop macOS and Windows, while Android uses embedded native modules.

OH supports two independent MCP directions with separate settings: exposing OH as a local MCP server for external tools, or connecting OH as a client to external MCP servers. WeChat and Feishu messaging channels are also configured independently.

When you chat with a model provider, it receives your prompt along with any context or files attached to that turn, so review attached files, active tool permissions, and your provider's privacy policy before sending. See [Privacy and diagnostics](privacy-and-troubleshooting.md) for data handling and log redaction details.
