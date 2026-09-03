# Prime Agent compatibility

Magic Context supports Prime Agent through a feature-detected `ExtensionContext.runAgent` adapter while preserving the existing Pi/OMP subprocess fallback.

See the detailed reports:

- `/home/cole/SiteResearch/anthropic/plugin-suite/magic-context-prime-compat.md`
- `/home/cole/SiteResearch/anthropic/plugin-suite/magic-context-run-agent-refactor.md`

Verified on 2026-09-03:

- `bun run --cwd packages/pi-plugin typecheck` — passed
- `bun test packages/pi-plugin/src/prime-child-runner.test.ts` — 7 passed
- full Pi plugin suite — 921 passed, 0 failed
- Prime package-loader source-load smoke test — passed with zero loader errors

The Prime path uses no tools for complete-input historian/reviewer work and exact narrow allowlists for repository investigators. Mutation workers require explicit user-owned configuration. Legacy tool names are never broadened to `ipython`.
