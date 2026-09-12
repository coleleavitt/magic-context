---
name: dashboard-feature-or-integration-implementation
description: Workflow command scaffold for dashboard-feature-or-integration-implementation in magic-context.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /dashboard-feature-or-integration-implementation

Use this workflow when working on **dashboard-feature-or-integration-implementation** in `magic-context`.

## Goal

Implements a new dashboard feature or integration, typically involving both Rust (Tauri backend) and TypeScript (React frontend) files.

## Common Files

- `packages/dashboard/src-tauri/src/commands.rs`
- `packages/dashboard/src-tauri/src/serve/mod.rs`
- `packages/dashboard/src-tauri/src/main.rs`
- `packages/dashboard/src/App.tsx`
- `packages/dashboard/src/components/*.tsx`
- `packages/dashboard/src/lib/api.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Update or add Rust files under packages/dashboard/src-tauri/src/ (e.g., commands.rs, serve/mod.rs, main.rs)
- Update or add TypeScript/React files under packages/dashboard/src/ (e.g., App.tsx, components/*, lib/api.ts, lib/types.ts)
- Optionally update Cargo.toml and/or build.rs for dependencies or build steps

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.