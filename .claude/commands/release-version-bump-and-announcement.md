---
name: release-version-bump-and-announcement
description: Workflow command scaffold for release-version-bump-and-announcement in magic-context.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /release-version-bump-and-announcement

Use this workflow when working on **release-version-bump-and-announcement** in `magic-context`.

## Goal

Prepares and announces a new release version, including updating package versions, writing release notes, and updating in-app announcements.

## Common Files

- `packages/cli/package.json`
- `packages/pi-plugin/package.json`
- `packages/plugin/package.json`
- `packages/dashboard/src-tauri/tauri.conf.json`
- `.alfonso/release-notes/*.md`
- `packages/plugin/src/shared/announcement.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Update package.json version(s) for CLI, plugin, and/or dashboard
- Add or update release notes in .alfonso/release-notes/
- Update in-app announcement/version file (e.g., src/shared/announcement.ts)
- Optionally fix or update related tests or configuration files

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.