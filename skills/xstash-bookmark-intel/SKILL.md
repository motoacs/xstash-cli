---
name: xstash-bookmark-intel
description: Retrieve and update a user's X bookmarks with the local `xstash` CLI, then analyze recent interests and convert them into concrete follow-up actions. Use when the user asks to sync bookmarks, inspect recent interests, create topic/person digests, or drive actions (ideas, tasks, recommendations) from bookmark history.
---

# xstash Bookmark Intel

Use `xstash` as the source of truth for bookmark data. Assume the `xstash` command is available on PATH.

## Workflow

1. Check current state.
2. Refresh bookmarks safely.
3. Export only the needed slice.
4. Derive interests from exported data.
5. Propose or execute next actions.

## 1) Check current state

Run:

```bash
xstash stats
```

If command output suggests no prior sync or missing auth, run:

```bash
xstash config init
```

Use `xstash config show` only for verification; treat values as sensitive even when masked.

## 2) Refresh bookmarks safely

Default refresh (incremental):

```bash
xstash sync --yes
```

Use constrained refresh when the user wants tighter cost/time control:

```bash
xstash sync --max-new <n> --yes
```

Use media-aware refresh only when needed:

```bash
xstash sync --media --yes
```

Notes:
- Prefer incremental refresh for routine analysis.
- Keep `--max-new` explicit for budget-sensitive runs.
- Do not print or persist secrets/tokens.

## 3) Export analysis-ready data

Prefer JSON for agent analysis:

```bash
xstash export --format json -o ./.xstash/tmp/xstash-bookmarks.json
```

For recency-focused analysis, filter by date:

```bash
xstash export --format json --since <YYYY-MM-DD> --until <YYYY-MM-DD> -o ./.xstash/tmp/xstash-bookmarks-window.json
```

Include referenced posts only when contextual threads are required:

```bash
xstash export --format json --include-referenced -o ./.xstash/tmp/xstash-bookmarks-with-context.json
```

Remember: `bookmark.bookmarked_at` is always `null` by design. Use `bookmark.discovered_at` and `bookmark.last_synced_at` for timeline analysis.

Path guidance:
- Prefer paths under the current working directory (for example, `./.xstash/tmp/...`) to reduce sandbox/permission friction for agents.
- Avoid hardcoded `/tmp` in shared instructions because it is Unix-specific and not portable to Windows.
- If OS temp storage is explicitly needed, use platform-aware environment variables:
  - Bash/zsh: `${TMPDIR:-/tmp}`
  - PowerShell: `$env:TEMP`

## 4) Derive interest signals

From exported JSON, extract:
- Frequent topics/keywords in recently discovered bookmarks.
- Repeated authors/accounts.
- Repeated link domains and media types.
- Momentum shifts between two time windows (older vs newer).

Always ground findings in explicit evidence (counts/examples), and separate facts from inference.

## 5) Convert insights into actions

Map inferred interests to actionable outputs, for example:
- Reading queue with top links by topic.
- Draft post/thread ideas aligned to repeated themes.
- Follow-up tasks (research, prototype, outreach).
- Suggested people/lists to monitor based on recurring authors.

When uncertainty is high, provide 2-3 plausible interpretations and ask the user to pick one direction.

## Command patterns for common requests

- "最新の関心を知りたい": incremental sync -> JSON export (last 7-14 days) -> topic/author summary.
- "この1か月の興味変化": two-window exports -> compare topics/authors/domains -> change report.
- "次に何をやるべきか": sync + export -> top signals -> prioritized action list.

See `references/analysis-playbook.md` for a compact analysis template.
