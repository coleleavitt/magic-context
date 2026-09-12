```markdown
# magic-context Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill covers the core development patterns, coding conventions, and workflows for contributing to the `magic-context` repository. The project is a hybrid TypeScript/Rust codebase, featuring a multi-package monorepo structure with a focus on CLI tools, a Tauri-powered dashboard, and advanced context/memory modules. You'll learn how to follow commit conventions, structure code, implement features across TypeScript and Rust, manage releases, write tests, and use common automation commands.

---

## Coding Conventions

### File Naming

- **TypeScript/JavaScript:** Use `camelCase` for file names.
  - Example: `opencodePluginCache.ts`, `badgeContrast.test.ts`
- **Rust:** Use `snake_case` for file names.
  - Example: `commands.rs`, `main.rs`

### Imports

- **Relative imports** are preferred in TypeScript:
  ```ts
  import { getPluginCache } from './opencodePluginCache';
  ```

### Exports

- **Named exports** are standard:
  ```ts
  // TypeScript
  export function getPluginCache() { ... }
  export const PLUGIN_CACHE_KEY = '...';
  ```

### Commit Patterns

- Prefixes: `fix`, `mason`, `test`, `release`, `docs`, `chore`
- Example:  
  ```
  fix: correct plugin cache invalidation logic
  docs: update architecture diagram in STRUCTURE.md
  ```

---

## Workflows

### Release Version Bump and Announcement

**Trigger:** When releasing a new version of the CLI, plugin, or dashboard.  
**Command:** `/release`

1. Update `package.json` version(s) for CLI, plugin, and/or dashboard:
   ```json
   // packages/cli/package.json
   {
     "version": "1.2.3"
   }
   ```
2. Add or update release notes in `.alfonso/release-notes/`.
3. Update in-app announcement/version file, e.g., `src/shared/announcement.ts`:
   ```ts
   export const ANNOUNCEMENT_VERSION = '1.2.3';
   ```
4. Optionally fix or update related tests or configuration files.

---

### Dashboard Feature or Integration Implementation

**Trigger:** When adding a new feature or integration to the dashboard, especially those that require backend/frontend coordination.  
**Command:** `/dashboard-feature`

1. Update or add Rust files under `packages/dashboard/src-tauri/src/` (e.g., `commands.rs`, `serve/mod.rs`, `main.rs`).
2. Update or add TypeScript/React files under `packages/dashboard/src/` (e.g., `App.tsx`, `components/`, `lib/api.ts`).
3. Optionally update `Cargo.toml` and/or `build.rs` for dependencies or build steps.

**Example:**  
_Adding a new dashboard command in Rust:_
```rust
// packages/dashboard/src-tauri/src/commands.rs
#[tauri::command]
pub fn new_feature_command() -> String {
    "Feature enabled!".to_string()
}
```
_Adding a React component:_
```tsx
// packages/dashboard/src/components/NewFeature.tsx
export function NewFeature() {
  return <div>New Dashboard Feature!</div>;
}
```

---

### Documentation Update or Release Notes

**Trigger:** When documenting new features, changes, or preparing release notes.  
**Command:** `/docs-update`

1. Update or add markdown files in documentation or release notes directories (e.g., `ARCHITECTURE.md`, `.alfonso/release-notes/`).
2. If relevant, update cross-references or troubleshooting sections.
3. Optionally update `.gitignore` for doc-related changes.

---

### CLI OpenCode Detection or Cache Fix

**Trigger:** When fixing or enhancing OpenCode CLI/desktop detection, or plugin cache logic in the CLI.  
**Command:** `/cli-opencode-fix`

1. Update CLI adapter files (e.g., `adapters/opencode.ts`).
2. Update or add CLI command files (e.g., `commands/doctor-opencode.ts`, `setup-opencode.ts`).
3. Update or add CLI lib files (e.g., `lib/opencode-detect.ts`, `opencode-plugin-cache.ts`).
4. Add or update related tests.

**Example:**  
```ts
// packages/cli/src/lib/opencode-detect.ts
export function detectOpenCode() {
  // detection logic
}
```
```ts
// packages/cli/src/lib/opencode-detect.test.ts
import { detectOpenCode } from './opencode-detect';
test('detects OpenCode correctly', () => {
  expect(detectOpenCode()).toBe(true);
});
```

---

### Test or CI Workflow Addition or Update

**Trigger:** When adding new tests, regression probes, or updating CI workflows for new features or bugfixes.  
**Command:** `/add-test`

1. Add or update `.github/workflows/*.yml` for CI or probe workflows.
2. Add or update test files in relevant package directories (e.g., `*.test.ts`).
3. Optionally update code to support new test cases.

**Example:**  
```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm install
      - run: npm test
```

---

### MC Module and MC Store Feature Slice

**Trigger:** When developing a new slice of the Magic Context Rust module (e.g., new m0/m1 logic, memory/history store, compartment logic).  
**Command:** `/mc-slice`

1. Add or update Rust source files in `crates/mc-core`, `crates/mc-module`, `crates/mc-store`.
2. Add or update migration logic and data structures.
3. Add or update corresponding tests in `tests/` or `testdata/`.
4. Update `Cargo.toml` and/or workspace files as needed.

**Example:**  
```rust
// crates/mc-store/src/history.rs
pub struct HistoryStore { /* fields */ }
impl HistoryStore {
    pub fn new() -> Self { /* ... */ }
}
```
```rust
// crates/mc-store/tests/history.rs
#[test]
fn test_history_store_add() {
    let mut store = HistoryStore::new();
    store.add("event");
    assert_eq!(store.count(), 1);
}
```

---

## Testing Patterns

- **Framework:** Jest (for TypeScript)
- **File pattern:** `*.test.ts`
- **Location:** Test files are placed alongside source files or in dedicated `tests/` directories.
- **Rust:** Tests are in `tests/` subfolders or inline with `#[cfg(test)]`.

**Example (TypeScript):**
```ts
// packages/plugin/src/tui/badge-contrast.test.ts
import { getBadgeContrast } from './badge-contrast';
test('badge contrast is correct', () => {
  expect(getBadgeContrast('#fff')).toBe('dark');
});
```

**Example (Rust):**
```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_compartment_logic() {
        assert!(compartment_is_valid());
    }
}
```

---

## Commands

| Command             | Purpose                                                        |
|---------------------|----------------------------------------------------------------|
| /release            | Prepare and announce a new release version                     |
| /dashboard-feature  | Implement a new dashboard feature or integration               |
| /docs-update        | Update documentation or release notes                          |
| /cli-opencode-fix   | Implement or fix OpenCode CLI/desktop detection or cache logic |
| /add-test           | Add or update tests or CI workflows                            |
| /mc-slice           | Implement a new feature slice in the Rust mc-module/mc-store   |
```
