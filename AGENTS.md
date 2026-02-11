# AGENTS.md

This file is the repository-level operating guide for AI coding agents working on `xstash-cli`.

## 1. Mission

- Build and maintain a personal CLI that syncs X bookmarks into local SQLite and exports them safely.
- Optimize for cost-aware sync, data integrity, and cross-platform operation (Windows, Ubuntu, macOS).
- Treat `docs/system-design.md` as the current source of truth for product behavior.

## 2. Instruction Scope and Precedence

- Scope: this file applies to the entire repository tree.
- If a deeper/nested `AGENTS.md` is added later, the deeper one overrides this file for its subtree.
- System/developer/user instructions in the active session always override repository docs.

## 3. Source of Truth

- Product/design requirements: `docs/system-design.md`
- Public overview: `README.md`
- If behavior changes, update both design and user docs in the same change when applicable.

## 4. Hard Guardrails (Do Not Break)

1. Do not use external X API client libraries. Use direct `fetch` calls.
2. Stop incremental sync boundary by checking `bookmarks` table presence, not only `posts`.
3. Apply `known_boundary_threshold` only in incremental mode; never use it to stop initial sync.
4. Do not persist real bookmark time from X (not provided). Use `bookmarks.discovered_at` / `last_synced_at` and keep export `bookmark.bookmarked_at` as `null`.
5. Track API usage via `api_requests` (all requests) and estimate billed reads with day/resource dedupe logic (`api_billable_reads` equivalent).
6. Keep media relation as many-to-many (`media` + `post_media`).
7. Keep token/secret values out of git and logs.
8. Avoid destructive DB changes without explicit migration plan and backward-compatibility rationale.
9. Preserve quote/reference resolution depth limit (`<= 3`) unless explicitly changed in design.

## 5. Security and Secrets

- Never commit real credentials, access tokens, refresh tokens, or `.env` secrets.
- Redact secrets in output (`config show` must mask).
- For local secret storage, follow project policy in `docs/system-design.md`:
  - Prefer CLI args > env vars > config file.
  - On Unix-like systems, ensure config file permission is `0600`.
- Do not include sensitive values in tests or snapshots.

## 6. Development Commands

Use Deno-based commands. Prefer `deno task` when tasks exist; otherwise use direct commands.

- Format: `deno task fmt || deno fmt`
- Lint: `deno task lint || deno lint`
- Type check: `deno task check || deno check src/**/*.ts`
- Tests: `deno task test || deno test -A`
- Run CLI locally: `deno task dev || deno run -A src/index.ts`

If repository bootstrapping is incomplete (missing `src/` or tasks), create minimal scaffolding first, then run the matching checks for touched files.

## 7. Testing Expectations

For any behavior change, add/update tests in the same patch.

- Unit tests:
  - pagination and incremental boundary logic
  - `known_boundary_threshold` behavior (incremental-only, streak-based stop)
  - `--max-new` semantics (initial vs incremental)
  - retry/backoff and rate-limit handling
  - quote-resolution depth limit
- Data-layer tests:
  - upsert/idempotency
  - `bookmarks.discovered_at` and `last_synced_at` semantics (including failed runs with partial updates)
  - bookmark boundary correctness
  - relation integrity (`post_references`, `post_media`)
  - API usage accounting (`api_requests` raw records + deduped estimated cost)
- Export tests:
  - JSON schema version and field stability
  - `bookmark.bookmarked_at = null` and `bookmarked_at_source` stability
  - date filters and `--include-referenced` behavior
  - Markdown format compliance (heading, quote nesting, media reference)

Default policy: no real network calls in tests. Mock/stub X API responses.

## 8. Implementation Conventions

- TypeScript strict-first mindset. Avoid `any` unless justified and localized.
- Keep modules focused:
  - `api/*` for remote concerns
  - `db/*` for persistence concerns
  - `commands/*` for CLI orchestration
  - `export/*` for output formatting only
- Store API raw payloads (`raw_json`) for lossless evolution.
- Use UTC ISO 8601 timestamps consistently.
- Write deterministic code paths for stable exports and tests.

## 9. Database and Migration Rules

- Use explicit schema management in `src/db/schema.ts` (or equivalent migration layer).
- Keep and advance DB schema version in `meta.schema_version` with ordered migrations.
- Schema changes must include:
  1. migration logic
  2. data compatibility notes
  3. test updates
- Prefer additive changes first; avoid dropping/renaming columns without fallback path.
- Add indexes when introducing new query patterns.

## 10. Cost and API Usage Discipline

- Any sync-related change must preserve or improve API call efficiency.
- Keep cost estimation visible in sync summary.
- Track API reads in durable tables/logs, including post/user read counts.
- When cost model assumptions change, update both implementation and docs.

## 11. CLI UX Rules

- User-facing summaries to stdout.
- Errors and diagnostics to stderr.
- Keep error messages actionable: include endpoint, status code, and resource id when known.
- Avoid silent partial failures; record run status (`running/completed/failed`) durably.

## 12. Cross-Platform Rules

- Support Windows, Ubuntu, macOS as first-class targets.
- Use path utilities, not hardcoded separators.
- Follow platform-specific config/data directories from `docs/system-design.md`.
- Keep binary build targets aligned with release workflow.

## 13. Operations and Maintenance

- For CI/release changes, validate build matrix continuity for:
  - macOS arm64/x64
  - Linux x64
  - Windows x64
- Any operational behavior change (logging, retries, failure handling) must include:
  1. regression test or rationale why not feasible
  2. docs update when user-facing

## 14. Definition of Done (for Agent Tasks)

A task is complete only when all are satisfied:

1. Code changes implemented.
2. Relevant tests added/updated.
3. Format/lint/type/test checks run (or clearly reported if blocked).
4. Docs updated when behavior/contracts changed.
5. No secrets introduced.
6. `git diff` scoped to requested work only.

## 15. Commit and Review Hygiene

- Keep commits focused and descriptive.
- Describe behavior changes and risks clearly in PR/summary.
- Call out follow-up work explicitly if scope is intentionally narrowed.
- If uncertain about requirements, ask before implementing speculative behavior.

## 16. AGENTS.md Maintenance

- Keep this file short, concrete, and executable.
- Prefer explicit commands over abstract guidance.
- Update this file when workflow, test commands, or architecture constraints change.
