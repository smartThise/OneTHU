# OneTHU technical architecture documentation

**Goal:** Describe the implemented prototype, data ownership, API contracts, SDK, CLI/agents, Gateway and OneGUI as one navigable technical reference.

**Source baseline:** `web` at `7c2e9612`; release behavior and installed artifacts remain separately identified.

1. Audit source owners, current references and generated catalogs.
2. Rewrite the architecture overview and API reference; add subsystem chapters with source links, request/state diagrams, limits and failure handling.
3. Provide equivalent English references and connect existing developer, CLI, design and documentation indexes.
4. Regenerate plugin API/inventory, validate local links and examples, run prose checks. Preserve dated incident evidence and avoid network/account mutations.
5. Commit documentation and doc-tool maintenance only. No app deployment or installer build.


## Completed

- Rewrote the system overview and API reference in Chinese/English; added five paired chapters for prototype/data, SDK, CLI/agents, Gateway and OneGUI. Fourteen technical reference pages now cover ownership, call/state diagrams, limits, policy, scheduling, recovery and actual platform acceptance.
- Connected the doc indexes, developer/CLI/design guides and package references. Regenerated the public plugin surface: 41 namespaces / 297 methods, separately from the 161 reviewed static CLI catalog entries. Browser-doc verification now reads the generated method count.
- Catalog generation identifies architecture/guides as current references and separates release notes and ADRs from historical plans. Preserved incident facts; prose fixes retained a quoted user instruction with a narrowly documented exemption.
- Parsed/rendered 14 technical pages, checked local links and technical anchors, JSON fences, language peers and generated row counts. `pnpm lint:docs` checks 250 documents with 0 violations. CLI catalog check and documentation-tool syntax checks passed.
- No application behavior, school account state, proxy settings, installed runtime or production website deployment changed.
