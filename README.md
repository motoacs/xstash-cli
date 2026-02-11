# xstash-cli

`xstash-cli` is a Deno-based CLI that syncs your X bookmarks into local SQLite, tracks API usage/cost estimates, and exports data as JSON/Markdown/CSV.

日本語版README: [README.ja.md](README.ja.md)

## Features

- Incremental bookmark sync with bookmark-boundary stop logic (`bookmarks` table based)
- Cost-aware sync (`--max-new`, pre-run estimate, API read accounting)
- Quote/reference resolution with BFS depth limit (`<= 3`)
- Optional media persistence and post-media many-to-many relation
- OAuth 2.0 Authorization Code + PKCE + refresh token support
- Export formats: `json` (`schema_version=1.1.0`), `md`, `csv`
- Stats command for bookmark volume, top authors, media breakdown, and estimated cost

## Quick Start

### 1. X API Credentials

Create an app at the X Developer Portal and obtain the following credentials:

- **Client ID** (OAuth 2.0 Client ID)
- **Client Secret** (Optional: for Confidential Clients)

Required scopes: `bookmark.read`, `tweet.read`, `users.read`, `offline.access`

### 2. Configure

#### Option A: Environment Variables (Recommended)

Create a `.env` file:

```bash
# Required
XSTASH_CLIENT_ID=your_client_id_here

# Optional (for Confidential Clients)
XSTASH_CLIENT_SECRET=your_client_secret_here
```

Then run OAuth authentication:

```bash
xstash config init
```

Your browser will open automatically for X account authorization.

#### Option B: Direct Config File

You can also edit the config file directly:

| OS | Config File Location |
|---|---|
| macOS | `~/Library/Application Support/xstash/config.json` |
| Linux | `~/.config/xstash/config.json` |
| Windows | `%APPDATA%\xstash\config.json` |

### 3. Sync Bookmarks

```bash
# Initial sync (latest 200 bookmarks)
xstash sync

# Sync all bookmarks
# xstash sync --max-new all
```

### 4. Export

```bash
# Export as JSON
xstash export --format json -o bookmarks.json

# Export as Markdown
xstash export --format md -o bookmarks.md
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `XSTASH_CLIENT_ID` | Yes | X API OAuth Client ID |
| `XSTASH_CLIENT_SECRET` | No | OAuth Client Secret (Confidential Client) |
| `XSTASH_ACCESS_TOKEN` | No | Existing access token |
| `XSTASH_REFRESH_TOKEN` | No | Existing refresh token |
| `XSTASH_TOKEN_EXPIRES_AT` | No | Token expiration (ISO 8601) |

**Precedence**: CLI args > Environment Variables > Config File

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

Artifacts are generated in `dist/<platform>/` by default, with binary name `xstash`
(`xstash.exe` on Windows).

## Notes

- Config precedence: CLI args > env vars > config file
- Unix config file permissions are set to `0600`
- Windows warns about ACL hardening in initial release
