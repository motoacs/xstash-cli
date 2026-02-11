# xstash-cli 詳細設計書

- 文書版数: v1.2
- 作成日: 2026-02-10
- 対象リポジトリ: `xstash-cli`
- 対象: Bookmarks 同期・保存・エクスポート CLI

## 1. 目的

`xstash-cli` は、X API v2 の Bookmarks をローカルに継続保存する個人向け CLI である。
本設計の最優先事項は以下の2点。

1. API 課金を抑えること（不要な再取得を避ける）
2. 同期の再現性と保守性を確保すること（中断復帰、スキーマ進化、可観測性）

## 2. スコープ

### 2.1 対象

1. `xstash sync`（増分同期、引用投稿解決、任意メディア保存）
2. `xstash export`（`md` / `csv` / 独自 `json`）
3. `xstash config`（OAuth 初期化、設定確認）
4. `xstash stats`（件数、期間、著者、メディア、コスト）
5. OAuth 2.0 Authorization Code + PKCE + Refresh Token 運用

### 2.2 非対象（初期版）

1. Web UI
2. REST API サーバ
3. Likes 同期
4. 全文検索
5. フォルダ分類
6. 内蔵スケジューラ（cron 前提）

## 3. 技術方針

1. Runtime: Deno v2.x
2. Language: TypeScript
3. DB: `node:sqlite`（Deno 2.2+）
4. HTTP: `fetch`
5. CLI: `@std/cli`（初期実装）
6. 配布: `deno compile --target` で単体バイナリ

## 4. 重要設計判断

## 4.1 取得上限のユーザー指定（初回コスト制御）

初回同期は「全件取得」を行わない。ユーザーが上限を指定できる設計にする。

- 追加オプション: `xstash sync --max-new <n|all>`
- 挙動:
  - 初回同期（ローカルに bookmark 未保存）: 既定値 `200`
  - 2回目以降:
    - オプション省略時: `all`（増分を全て取得）
    - `--max-new n` 指定時: 増分を `n` 件まで取得
- `--max-new all` は明示指定時のみ許可（初回の誤爆防止）

## 4.2 実行前コスト提示

`xstash sync` 実行前にコスト見積を表示する。

- 表示項目:
  1. 今回取得上限（`max-new`）
  2. 1投稿単価（設定値）
  3. 投稿課金の上限見積（`max-new * unit_price_post_read`）
  4. 補助見積（User Read などの追加取得分）
- 既定動作: 表示のみ
- `--confirm-cost` 指定時: 確認プロンプトで続行可否を問う
- `--yes` 指定時: プロンプトを省略

注記: X 側日次重複排除（UTC 24h）は「見積の不確実要素」として常に明示する。

## 4.3 増分停止条件（既知境界しきい値）

停止判定は `posts` ではなく `bookmarks` テーブルに対して行う。
ただし既知IDを1件見つけただけでは停止せず、連続一致しきい値を使う。

- 誤り: 「`posts` に既存なら停止」
- 修正: 「`bookmarks` に既存でも継続し、連続 `N` 件既知で停止」
- 既定値: `known_boundary_threshold = 5`
- 適用範囲: この停止条件は `mode=incremental` のときのみ適用する。`mode=initial` では適用しない。

これにより、引用解決で先行保存された投稿（`bookmarked` ではない）誤判定に加え、
「解除後の再ブックマーク」で先頭に再出現した既知投稿の直後にある新規投稿を取りこぼしにくくする。

## 4.4 OAuth とトークン更新

OAuth 2.0 Authorization Code Flow with PKCE を採用する。
必要スコープは少なくとも次を想定する。

1. `bookmark.read`
2. `tweet.read`
3. `users.read`
4. `offline.access`（refresh token 運用）

アクセストークン期限切れ時は refresh token で自動更新し、更新後は即時永続化する。

## 4.5 クロスプラットフォーム秘密情報保管

個人用ツールであるため、以下の優先順で運用する。

1. CLI 引数（最優先）
2. 環境変数（`.env` 含む）
3. 設定ファイル（`config.json`）

最低要件:

1. UNIX 系は `0600` パーミッションで保存
2. `xstash config show` は機密値をマスク表示
3. Windows は ACL 厳格化の自動制御を行わず、初期版は「ローカル端末前提」の警告表示で運用

## 4.6 ブックマーク日時の扱い

X Bookmarks API は「実際にブックマークした日時」を返さない前提で扱う。
そのため本設計では `bookmarked_at` を永続化しない。

1. `bookmarks.discovered_at`: xstash が当該投稿を bookmark として最初に観測した時刻
2. `bookmarks.last_synced_at`: 直近同期で当該投稿を観測した時刻
3. エクスポート上の `bookmark.bookmarked_at` は `null` 固定

## 5. CLI 仕様

## 5.1 sync

`xstash sync [--max-new <n|all>] [--media] [--confirm-cost] [--yes]`

- `--max-new`: 新規 bookmark の最大保存件数
- `--media`: メディアを保存
- `--confirm-cost`: 実行前確認を要求
- `--yes`: すべての確認を自動承認

同期完了時サマリ:

1. 新規 bookmark 件数
2. 参照解決投稿件数
3. 新規メディア保存件数
4. API 読み取り件数（post/user。生リクエスト件数）
5. スキップしたメディアDL件数（権限不足・削除等）
6. 推定コスト（今回 / 累計。日次重複排除後）

## 5.2 export

`xstash export --format <md|csv|json> [--since <date>] [--until <date>] [--include-referenced] [-o <path>]`

## 5.3 config

1. `xstash config init [--callback-port <port>] [--no-browser]`
2. `xstash config show`
3. `xstash config path`

## 5.4 stats

`xstash stats`

- 総 bookmark 数
- 期間
- 著者上位
- メディア内訳
- API 課金推定（投稿・ユーザー別）

## 6. データ設計（SQLite）

`posts` を「すべての取得投稿」、`bookmarks` を「ユーザーが保存した投稿」に分離する。
また、メディアを多対多対応にするため `post_media` を導入する。

```sql
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT,
  username TEXT,
  profile_image_url TEXT,
  verified INTEGER DEFAULT 0,
  verified_type TEXT,
  raw_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  text TEXT NOT NULL DEFAULT '',
  full_text TEXT,
  created_at TEXT NOT NULL,
  conversation_id TEXT,
  lang TEXT,
  possibly_sensitive INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  retweet_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  quote_count INTEGER DEFAULT 0,
  raw_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookmarks (
  post_id TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  discovered_at TEXT NOT NULL,
  last_synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS post_references (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  referenced_post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reference_type TEXT NOT NULL, -- quoted | replied_to | retweeted
  depth INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (post_id, referenced_post_id, reference_type)
);

CREATE TABLE IF NOT EXISTS media (
  media_key TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  url TEXT,
  preview_image_url TEXT,
  alt_text TEXT,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  variants_json TEXT,
  local_path TEXT,
  raw_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS post_media (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_key TEXT NOT NULL REFERENCES media(media_key) ON DELETE CASCADE,
  PRIMARY KEY (post_id, media_key)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  mode TEXT NOT NULL, -- initial | incremental
  requested_max_new INTEGER, -- NULL means all
  new_bookmarks_count INTEGER NOT NULL DEFAULT 0,
  new_referenced_posts_count INTEGER NOT NULL DEFAULT 0,
  new_media_count INTEGER NOT NULL DEFAULT 0,
  api_posts_read_count INTEGER NOT NULL DEFAULT 0,
  api_users_read_count INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0, -- this run's deduped estimate by (billed_day_utc, resource_type, resource_id)
  error_message TEXT,
  CHECK (requested_max_new IS NULL OR requested_max_new > 0)
);

CREATE TABLE IF NOT EXISTS api_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_run_id INTEGER NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  requested_at TEXT NOT NULL,
  billed_day_utc TEXT NOT NULL, -- YYYY-MM-DD (UTC)
  resource_type TEXT NOT NULL,  -- post | user
  resource_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  unit_price_usd REAL NOT NULL
);

CREATE VIEW IF NOT EXISTS api_billable_reads AS
SELECT
  billed_day_utc,
  resource_type,
  resource_id,
  MIN(unit_price_usd) AS unit_price_usd, -- usually identical per key; MIN is deterministic and conservative
  COUNT(*) AS request_count
FROM api_requests
GROUP BY billed_day_utc, resource_type, resource_id;

CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
CREATE INDEX IF NOT EXISTS idx_bookmarks_last_synced_at ON bookmarks(last_synced_at);
CREATE INDEX IF NOT EXISTS idx_post_references_ref ON post_references(referenced_post_id);
CREATE INDEX IF NOT EXISTS idx_api_requests_run ON api_requests(sync_run_id);
CREATE INDEX IF NOT EXISTS idx_api_requests_billable_key ON api_requests(
  billed_day_utc,
  resource_type,
  resource_id
);
```

## 6.1 スキーマ上の改善点（旧案との差分）

1. `is_bookmarked` を廃止し、`bookmarks` に分離
2. `media.post_id` を廃止し、`post_media` で多対多化
3. `users.name` / `users.username` を NULL 許容
4. `posts.author_id` を NULL 許容 + `ON DELETE SET NULL`
5. 課金追跡を `api_requests`（全量）+ `api_billable_reads`（日次重複排除）に分離
6. `sync_runs.requested_max_new` を `INTEGER NULL`（NULL=all）に変更

## 6.2 コスト集計定義

`sync_runs.estimated_cost_usd` は「当該 run 内で日次重複排除した推定課金額」とする。

1. 対象: `api_requests` の `sync_run_id = :run_id`
2. 重複排除キー: `(billed_day_utc, resource_type, resource_id)`
3. 推定式:

```sql
SELECT COALESCE(SUM(unit_price_usd), 0.0) AS estimated_cost_usd
FROM (
  SELECT billed_day_utc, resource_type, resource_id, MIN(unit_price_usd) AS unit_price_usd
  FROM api_requests
  WHERE sync_run_id = :run_id
  GROUP BY billed_day_utc, resource_type, resource_id
) t;
```

補足: 同一 run が UTC 日付をまたぐ場合、同一 `resource_id` でも `billed_day_utc` が異なれば別課金単位として加算する。

## 6.3 スキーママイグレーション方針

1. `meta` に `schema_version` を保持する（初期値 `1`）
2. 起動時に `schema_version` を確認し、差分があれば段階的に migration SQL を適用する
3. migration は原則 additive（列追加・テーブル追加）を優先し、破壊的変更は互換手順を併記する

## 7. 同期アルゴリズム

## 7.1 bookmark 取得（ページング）

1. `sync_runs` を `running` で作成
2. 取得モード判定（初回 or 増分）
3. `max-new` と `known_boundary_threshold` を確定
4. `GET /2/users/:id/bookmarks` をページング
5. 各投稿を新しい順に処理
   - `bookmarks` に既存:
     - `bookmarks.last_synced_at` を更新
     - `known_streak += 1`
   - 未保存:
     - `posts` upsert + `bookmarks` insert（`discovered_at=now`, `last_synced_at=now`）
     - `known_streak = 0`
6. 増分モードで `known_streak >= known_boundary_threshold` なら停止
7. `new_bookmarks_count == max-new` なら停止
8. DB 更新はページ単位トランザクションで即時コミットする（run 全体の一括コミットはしない）
9. `bookmarks.last_synced_at` は「観測時刻」であり、`sync_runs.status` と独立して更新される（`failed` run でも一部更新され得る）

## 7.2 参照投稿解決（引用優先）

1. 起点投稿の `referenced_tweets` は `quoted` / `replied_to` / `retweeted` を全て `post_references` に保存
2. API 追加取得は `reference_type = quoted` のみを対象とする
3. `replied_to` / `retweeted` は expansion に含まれる場合のみ保存し、追加 API 取得は行わない
4. 深さ優先ではなく BFS で `depth <= 3`
5. 取得前に `posts` 存在確認
6. 未保存の `quoted` ID は `GET /2/tweets?ids=...` で最大100件ずつバッチ取得
7. コスト追跡は「リクエスト数」ではなく「取得された投稿数（resource_id 数）」で行う

## 7.3 メディア保存（`--media`）

1. `includes.media` を `media` / `post_media` に upsert
2. `local_path` は `<data_root>/media/<media_key[0:2]>/<media_key>.<ext>` に正規化して保存
3. `local_path` が存在しファイル実体がある場合は再DLしない
4. `ext` は `Content-Type` 優先、取得不可時は URL 末尾から推定、最終手段は `bin`
5. video は `variants` から最高品質を選択
6. 429/5xx は再試行ポリシーに従う
7. `401/403/404/410` のDL失敗は警告してスキップし、同期全体は継続する

## 7.4 users 更新ポリシー

1. `includes.users` を受け取るたびに `users` は最新値で upsert する（last-write-wins）
2. `fetched_at` は常に更新する
3. 応答に存在しない任意フィールドは既存値を保持してもよい（null で上書きしない）

## 8. エラー処理・再試行・レート制限

1. `429`: `x-rate-limit-reset` 優先、なければ `Retry-After` を使用
2. `5xx` / ネットワーク失敗: 指数バックオフ（最大3回、ジッターあり）
3. メディアDLの `401/403/404/410` は warning を出してスキップ（run は継続）
4. それ以外の恒久失敗は `sync_runs.status='failed'` と `error_message` に記録
5. 再実行時は `bookmarks` 境界判定により自然に再開

## 9. OAuth/設定ファイル設計

## 9.1 config ファイル例

```json
{
  "version": 1,
  "oauth": {
    "client_id": "xxxxxxxx",
    "client_secret": "xxxxxxxx",
    "access_token": "xxxxxxxx",
    "refresh_token": "xxxxxxxx",
    "expires_at": "2026-02-10T12:34:56Z",
    "scopes": ["bookmark.read", "tweet.read", "users.read", "offline.access"]
  },
  "sync": {
    "default_initial_max_new": 200,
    "default_incremental_max_new": "all",
    "quote_resolve_max_depth": 3,
    "known_boundary_threshold": 5
  },
  "cost": {
    "unit_price_post_read_usd": 0.005,
    "unit_price_user_read_usd": 0.01
  }
}
```

`default_incremental_max_new` は `INTEGER` または `"all"` を許容する。
内部表現は `sync_runs.requested_max_new` に合わせ、`"all"` を `NULL` に正規化して保存する。

## 9.2 環境変数（`.env` 互換）

1. `XSTASH_CLIENT_ID`
2. `XSTASH_CLIENT_SECRET`
3. `XSTASH_ACCESS_TOKEN`
4. `XSTASH_REFRESH_TOKEN`
5. `XSTASH_TOKEN_EXPIRES_AT`

CLI 起動時に、カレントディレクトリの `.env` が存在すれば読み込む。
ただし、すでにプロセス環境変数に設定されているキーは上書きしない。

優先順位: CLI 引数 > 環境変数 > config ファイル

## 9.3 パス設計

1. Linux:
   - Config: `${XDG_CONFIG_HOME:-~/.config}/xstash/config.json`
   - Data root: `${XDG_DATA_HOME:-~/.local/share}/xstash`
   - DB: `${XDG_DATA_HOME:-~/.local/share}/xstash/xstash.db`
   - Media: `${XDG_DATA_HOME:-~/.local/share}/xstash/media/`
2. macOS:
   - Config: `~/Library/Application Support/xstash/config.json`
   - Data root: `~/Library/Application Support/xstash`
   - DB: `~/Library/Application Support/xstash/xstash.db`
   - Media: `~/Library/Application Support/xstash/media/`
3. Windows:
   - Config: `%APPDATA%\\xstash\\config.json`
   - Data root: `%LOCALAPPDATA%\\xstash`
   - DB: `%LOCALAPPDATA%\\xstash\\xstash.db`
   - Media: `%LOCALAPPDATA%\\xstash\\media\\`

## 9.4 PKCE コールバック受信

`xstash config init` の認可コード受信方式を次で固定する。

1. `127.0.0.1` の一時 HTTP サーバーで受信する（既定ポート: `38080`）
2. 既定ポートが使用中なら空きポートを探索し、実際に使う redirect URI を認可URL生成前に確定する
3. 既定でブラウザを自動起動し、`--no-browser` 指定時はURLを標準出力に表示する
4. 最初の有効コールバックを受信後にトークン交換し、成功/失敗の短いHTMLを返してサーバーを終了する
5. 120秒でタイムアウトし、失敗として終了する

## 10. JSON エクスポート仕様（独自）

## 10.1 トップレベル

```json
{
  "schema_version": "1.1.0",
  "exported_at": "2026-02-10T10:00:00Z",
  "filters": {
    "since": "2026-01-01T00:00:00Z",
    "until": "2026-02-10T23:59:59Z",
    "include_referenced": false
  },
  "counts": {
    "posts": 120,
    "bookmarks": 120,
    "referenced_posts": 35,
    "media": 40
  },
  "items": []
}
```

## 10.2 `items[]` 要素

```json
{
  "post": {
    "id": "123",
    "created_at": "2026-02-01T09:00:00Z",
    "text": "...",
    "full_text": "...",
    "lang": "ja",
    "possibly_sensitive": false,
    "metrics": {
      "like_count": 1,
      "retweet_count": 0,
      "reply_count": 0,
      "quote_count": 0
    },
    "url": "https://x.com/{author_username}/status/123"
  },
  "author": {
    "id": "u1",
    "username": "alice",
    "name": "Alice",
    "verified": false,
    "verified_type": null,
    "profile_image_url": null
  },
  "bookmark": {
    "bookmarked_at": null,
    "bookmarked_at_source": "not_provided_by_x_api",
    "discovered_at": "2026-02-10T10:01:00Z",
    "last_synced_at": "2026-02-10T10:01:00Z"
  },
  "media": [
    {
      "media_key": "3_abc",
      "type": "photo",
      "url": "https://...",
      "local_path": "/path/to/file"
    }
  ],
  "references": [
    {
      "type": "quoted",
      "depth": 1,
      "post_id": "999"
    }
  ],
  "raw": {
    "post": {},
    "author": {},
    "media": []
  }
}
```

## 10.3 JSON スキーマ運用規則

1. 後方互換を壊す変更は `schema_version` をメジャー更新
2. `raw` はロスレス再解析用（将来変換に利用）
3. `include_referenced=false` 時は bookmark 起点投稿のみ `items` に含める

## 10.4 Markdown エクスポート仕様

初期版は「1回の export で1ファイル」を標準とする（投稿分割は非対応）。

1. 出力先:
   - `-o` 未指定: stdout
   - `-o` がディレクトリ: `<dir>/bookmarks.md`
   - `-o` がファイル: 指定パス
2. 並び順: `bookmarks.last_synced_at DESC`、同値時 `post.id DESC`
3. 各投稿ブロック:
   - 見出し: `## @{username} | {created_at} | {post_id[:8]}`
   - 本文: `post.full_text || post.text`
   - メタ: 投稿URL、`created_at`、`bookmark.discovered_at`
4. 引用投稿: `>` の入れ子で `depth` を表現（最大3段）
5. メディア:
   - `local_path` が存在すれば `![alt](local_path)`
   - なければ `![alt](url)` またはリンク

## 11. 実装構成

```text
src/
  index.ts
  commands/
    sync.ts
    export.ts
    config.ts
    stats.ts
  api/
    client.ts
    bookmarks.ts
    tweets.ts
    auth.ts
  db/
    connection.ts
    schema.ts
    posts.ts
    bookmarks.ts
    references.ts
    media.ts
    sync-runs.ts
    api-requests.ts
  export/
    markdown.ts
    csv.ts
    json.ts
  utils/
    config.ts
    paths.ts
    logger.ts
    retry.ts
```

## 12. 受け入れ基準

1. 初回同期で `--max-new` により保存件数を制御できる
2. 2回目以降、既定で増分全件取得できる
3. `--max-new` 指定で増分上限制御できる
4. 既知判定は `bookmarks` 基準で、連続一致しきい値で停止する
5. 引用解決は深さ3で停止する
6. OAuth 更新後トークンが永続化される
7. Windows / Ubuntu / macOS で設定・DB・出力が動作する
8. JSON エクスポートが本設計の `schema_version=1.1.0` を満たす
9. API リクエスト全量記録と日次重複排除集計が両立している
10. Markdown エクスポートが 10.4 に準拠し、引用ネストとメディア参照が正しく出力される

## 13. 将来拡張

1. Usage API 連携による実コスト照合
2. OS キーチェーン統合（任意）
3. バッチ取得最適化（参照投稿 lookup の集約）
4. 差分エクスポート（前回エクスポート以降）
