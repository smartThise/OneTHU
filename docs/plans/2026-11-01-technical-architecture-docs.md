# OneTHU technical architecture documentation


**Goal:** Document the implemented prototype, data ownership model, API contracts, SDK, CLI/agents, Gateway, and OneGUI as a cohesive, navigable technical reference.

**Source baseline:** `web` branch at `7c2e9612`, keeping published release behavior and locally installed runtime artifacts clearly distinguished alongside the branch source.

1. Audit source module owners, existing reference docs, and generated capability catalogs.
2. Rewrite the architecture overview and API reference, adding dedicated subsystem chapters with source file links, request and state diagrams, operational limits, and failure-recovery paths.
3. Author matching English reference chapters and cross-link the developer, CLI, design, and documentation indexes.
4. Regenerate the plugin API reference and inventory, validate local links and JSON examples, and run documentation prose lints while preserving dated incident records and keeping local network and account state untouched.
5. Commit documentation and doc-tooling updates only, with no application deployment or installer builds.

## Completed

- Rewrote the system overview and API reference in both Chinese and English, and added five paired subsystem chapters covering prototype/data ownership, SDK, CLI/agents, Gateway, and OneGUI. Fourteen technical reference pages now document module ownership, call and state diagrams, resource limits, authorization policy, task scheduling, failure recovery, and verified platform behavior.
- Connected the top-level documentation indexes, developer/CLI/design guides, and package READMEs. Regenerated the public plugin API surface (41 namespaces / 297 methods), documented alongside the 161 reviewed static CLI catalog entries, and updated browser-doc verification to read the generated method count directly.
- Updated catalog generation so architecture docs and user guides appear as current references while release notes and ADRs are grouped cleanly beside historical plans. Dated incident facts remain intact, and prose lints retain a narrowly scoped exemption for a verbatim quoted user instruction.
- Parsed and rendered all 14 technical reference pages, verifying local file links, heading anchors, JSON code fences, Chinese/English peer parity, and generated table row counts. `pnpm lint:docs` passed across all 250 documents with 0 violations, alongside the CLI catalog check and documentation-tooling syntax checks.
- Application code, signed-in school sessions, system proxy settings, locally installed runtimes, and the production website remained untouched throughout this documentation pass.
