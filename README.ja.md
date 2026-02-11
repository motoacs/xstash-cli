# xstash-cli

`xstash-cli`は、XのブックマークをローカルSQLiteへ同期し、API使用量とコスト見積もりを追跡し、JSON/Markdown/CSVでエクスポートできるDeno製CLIです。

## 主な機能

- ブックマーク境界に基づく増分同期（`bookmarks`テーブル基準の停止ロジック）
- コストを意識した同期（`--max-new`、実行前見積もり、API読み取り記録）
- BFS深さ制限（`<= 3`）付きの引用/参照解決
- メディア保存（任意）と投稿-メディア多対多リレーション
- OAuth 2.0 Authorization Code + PKCE + リフレッシュトークン対応
- エクスポート形式: `json`（`schema_version=1.1.0`）、`md`、`csv`
- ブックマーク件数、上位投稿者、メディア内訳、推定コストを確認できる`stats`コマンド

## クイックスタート

### 1. X API認証情報

X Developer Portalでアプリを作成し、以下を取得してください。

- **Client ID**（OAuth 2.0 Client ID）
- **Client Secret**（任意: Confidential Clientの場合）

必要スコープ: `bookmark.read`, `tweet.read`, `users.read`, `offline.access`

#### アプリ種別の選択（重要）

X Developer Portalでアプリ作成時は、`xstash-cli`の使い方に応じて選択してください。

- **Native App / Public Client**（通常はこちらを推奨）
  - ローカルPC上で個人CLIとして使う場合に選択します。
  - `xstash-cli`はAuthorization Code + PKCEを使うため、Client Secretは必須ではありません。
- **Web App / Automated App or Bot / Confidential Client**
  - Client Secretを使って運用したい場合にのみ選択します。
  - `XSTASH_CLIENT_ID` と `XSTASH_CLIENT_SECRET` の両方を設定してください。

#### Callback URL / Redirect URI

`xstash-cli` はローカルループバックでOAuthコールバックを受け取ります。

- 既定のリダイレクトURI: `http://127.0.0.1:38080/callback`
- `xstash config init --callback-port <port>` を使う場合: `http://127.0.0.1:<port>/callback`

Xアプリ設定には、実際に使う callback URL を完全一致で登録してください。

### 2. 設定

#### 方法A: 環境変数（推奨）

`.env`ファイルを作成:

```bash
# 必須
XSTASH_CLIENT_ID=your_client_id_here

# 任意（Confidential Clientの場合）
XSTASH_CLIENT_SECRET=your_client_secret_here
```

続いてOAuth認証を実行:

```bash
xstash config init
```

`xstash` は起動時にカレントディレクトリの `.env` を自動読み込みします。
シェル側ですでに設定済みの環境変数は上書きされません。

Xアカウント認可のため、ブラウザが自動で開きます。

#### 方法B: 設定ファイルを直接編集

設定ファイルを直接編集することもできます。

| OS      | 設定ファイルの場所                                 |
| ------- | -------------------------------------------------- |
| macOS   | `~/Library/Application Support/xstash/config.json` |
| Linux   | `~/.config/xstash/config.json`                     |
| Windows | `%APPDATA%\xstash\config.json`                     |

### 3. ブックマーク同期

```bash
# 初回同期（最新200件）
xstash sync

# 全件同期
# xstash sync --max-new all
```

### 4. エクスポート

```bash
# JSONでエクスポート
xstash export --format json -o bookmarks.json

# Markdownでエクスポート
xstash export --format md -o bookmarks.md
```

## 環境変数

| 変数名                    | 必須 | 説明                                       |
| ------------------------- | ---- | ------------------------------------------ |
| `XSTASH_CLIENT_ID`        | Yes  | X API OAuth Client ID                      |
| `XSTASH_CLIENT_SECRET`    | No   | OAuth Client Secret（Confidential Client） |
| `XSTASH_ACCESS_TOKEN`     | No   | 既存のアクセストークン                     |
| `XSTASH_REFRESH_TOKEN`    | No   | 既存のリフレッシュトークン                 |
| `XSTASH_TOKEN_EXPIRES_AT` | No   | トークン有効期限（ISO 8601）               |

**優先順位**: CLI引数 > 環境変数 > 設定ファイル

起動時にカレントディレクトリの `.env` を環境変数として読み込みます。

## インストール / 実行

Deno v2.xが必要です。

```bash
deno task dev -- --help
```

## コマンド

```bash
xstash sync [--max-new <n|all>] [--media] [--confirm-cost] [--yes]
xstash export --format <md|csv|json> [--since <date>] [--until <date>] [--include-referenced] [-o <path>]
xstash config init [--callback-port <port>] [--no-browser]
xstash config show
xstash config path
xstash stats
```

## 設計上の契約

- 外部X API SDKは不使用: `fetch`を直接利用
- 増分停止は`posts`ではなく`bookmarks`の存在で判定
- `known_boundary_threshold`は増分モードでのみ適用
- X APIは実際のブックマーク時刻を返さないため、エクスポートでは以下を使用:
  - `bookmark.bookmarked_at = null`
  - `bookmark.bookmarked_at_source = "not_provided_by_x_api"`
- API使用量は`api_requests`に記録し、重複除外したコスト見積もりは`(billed_day_utc, resource_type, resource_id)`で計算

## 開発

```bash
deno task fmt
deno task lint
deno task check
deno task test
```

## 単体バイナリのビルド

Linux/macOS/Windows向けバイナリは以下でビルドできます。

```bash
bash scripts/build-binaries.sh
```

成果物はデフォルトで`dist/<platform>/`に生成され、バイナリ名は`xstash`です
（Windowsは`xstash.exe`）。

## 補足

- 設定の優先順位: CLI引数 > 環境変数 > 設定ファイル
- Unix系OSでは設定ファイル権限を`0600`に設定
- Windowsは初期リリースでACL強化に関する警告を表示
