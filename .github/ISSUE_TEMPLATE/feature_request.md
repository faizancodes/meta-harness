---
name: Feature request
about: Propose a metaharness SDK, CLI, adapter, policy, docs, or workflow improvement
title: "[Feature]: "
labels: enhancement
assignees: ""
---

## Problem

What developer or platform workflow is hard today?

## Proposed Shape

Describe the SDK API, CLI command, adapter behavior, policy option, docs change,
or workflow you want.

## Provider Capability Impact

- Does this need a new or changed `ProviderCapabilities` flag?
- Which providers can support it today: mock / Claude / Cursor / Codex?
- What should happen for unsupported providers?

## Compatibility

- Public API impact:
- CLI output or JSON impact:
- Config/schema impact:
- Package, peer dependency, or optional SDK impact:
- Generated docs/schema impact:

## Validation Plan

Which checks should prove this works?

- [ ] Unit tests:
- [ ] CLI/help/docs guards:
- [ ] Generated artifact checks:
- [ ] Mock conformance:
- [ ] Live provider conformance, if intentionally gated:

## Safety Notes

Mention any implications for `.harness/` artifacts, redaction, raw provider
events, policy enforcement, provider-native state, or handoff claims.
