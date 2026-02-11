# xstash-cli

`xstash-cli` is a Deno-based CLI that syncs your X bookmarks into local SQLite, tracks API usage/cost estimates, and exports data as JSON/Markdown/CSV.

## Features

- Incremental bookmark sync with bookmark-boundary stop logic (`bookmarks` table based)
- Cost-aware sync (`--max-new`, pre-run estimate, API read accounting)
- Quote/reference resolution with BFS depth limit (`<= 3`)
- Optional media persistence and post-media many-to-many relation
- OAuth 2.0 Authorization Code + PKCE + refresh token support
- Export formats: `json` (`schema_version=1.1.0`), `md`, `csv`
- Stats command for bookmark volume, top authors, media breakdown, and estimated cost

## Install / Run

Requires Deno v2.x.

```bash
deno task dev -- --help
```

## Commands

```bash
xstash sync [--max-new <n|all>] [--media] [--confirm-cost] [--yes]
xstash export --format <md|csv|json> [--since <date>] [--until <date>] [--include-referenced] [-o <path>]
xstash config init [--callback-port <port>] [--no-browser]
xstash config show
xstash config path
xstash stats
```

## Design Contracts

- No external X API SDK: direct `fetch` only
- Incremental stop checks `bookmarks` presence, not `posts`
- `known_boundary_threshold` applies to incremental mode only
- X bookmark time is not persisted from API; exports use:
  - `bookmark.bookmarked_at = null`
  - `bookmark.bookmarked_at_source = "not_provided_by_x_api"`
- API usage is tracked in `api_requests` and deduped cost estimates use `(billed_day_utc, resource_type, resource_id)`

## Development

```bash
deno task fmt
deno task lint
deno task check
deno task test
```

## Build Single Binaries

Build Linux/macOS/Windows binaries with:

```bash
bash scripts/build-binaries.sh
```

Artifacts are generated in `dist/` by default.

## Notes

- Config precedence: CLI args > env vars > config file
- Unix config file permissions are set to `0600`
- Windows warns about ACL hardening in initial release
