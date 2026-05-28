# Google Tasks Due Date Automation

Google Tasksで期限日が未設定の未完了タスクに、スクリプトのタイムゾーン基準で今日の日付を自動設定するApps Scriptです。

## 機能

- すべてのタスクリストを対象にします。
- 未完了、未削除、非表示でないタスクだけを対象にします。
- `due` が未設定のタスクだけ更新します。既存の `due` は上書きしません。
- `due` 以外のタスク名、メモ、ステータスなどは変更しません。
- タイトルに `[no-date]` または `#someday` を含むタスクは除外します。
- APIのページネーションに対応しています。
- デフォルトの最大更新件数は50件です。
- ドライラン、実更新、2時間ごとのトリガー作成用の関数があります。
- 1時から7時までは実更新をスキップします。

## ファイル構成

```text
src/Code.js
appsscript.json
.clasp.json.example
.github/workflows/ci.yml
.github/workflows/deploy.yml
README.md
package.json
.gitignore
```

## 初回セットアップ

1. Google Cloudで対象プロジェクトを開きます。
2. Google Cloud側でGoogle Tasks APIを有効化します。
3. Apps Scriptエディタで「サービス」から高度なGoogleサービスのTasks APIを有効化します。
4. ローカルで依存関係をインストールします。

```bash
npm install
```

## claspログイン手順

```bash
npx clasp login
```

既存のApps Scriptへ紐づける場合は、`.clasp.json.example` を参考にローカルだけで `.clasp.json` を作成してください。

```json
{
  "scriptId": "YOUR_SCRIPT_ID",
  "rootDir": "."
}
```

`.clasp.json` はリポジトリにコミットしません。

## デプロイ

手動でApps Scriptへ反映する場合:

```bash
npx clasp push --force
```

GitHub Actionsでは `main` ブランチへのpush時に同じく `clasp push --force` を実行します。

Actions画面から `Deploy Apps Script` workflowを手動実行することもできます。

## GitHub Secrets設定

リポジトリのSettings > Secrets and variables > Actionsに以下を設定してください。

- `CLASP_CREDENTIALS`: `~/.clasprc.json` の `oauth2ClientSettings` のJSON
- `CLASP_TOKEN`: `~/.clasprc.json` の `token` のJSON
- `SCRIPT_ID`: Apps ScriptのScript ID

セキュリティ上、ローカルのOAuthトークンを自動でGitHub Secretsへ登録する操作は行わず、GitHubの画面またはGitHub CLIで手動登録してください。

例:

```json
// CLASP_CREDENTIALS
{
  "clientId": "...",
  "clientSecret": "...",
  "redirectUri": "http://localhost"
}
```

```json
// CLASP_TOKEN
{
  "access_token": "...",
  "refresh_token": "...",
  "scope": "...",
  "token_type": "Bearer",
  "expiry_date": 1234567890000
}
```

## 2時間ごとのトリガー作成手順

Apps Scriptエディタで `createTwoHourlyTrigger` を手動実行してください。

この関数は、`setTodayForUndatedTasks` の既存トリガーを削除してから、2時間ごとの時間主導型トリガーを作成します。重複トリガーは増えません。

互換用に `createHourlyTrigger` も残していますが、現在は同じく2時間ごとのトリガーを作成します。

## ドライラン実行手順

Apps Scriptエディタで `dryRunSetTodayForUndatedTasks` を実行してください。

更新対象、スキップ、エラー、サマリーがログに出ます。実際のタスクは更新しません。

## 手動実行手順

Apps Scriptエディタで `setTodayForUndatedTasks` を実行してください。

`due` がない未完了タスクに、スクリプトのタイムゾーン基準の今日の日付を `yyyy-MM-ddT00:00:00.000Z` 形式で設定します。

## 設定

[src/Code.js](src/Code.js) の `CONFIG` を変更できます。

```javascript
var CONFIG = {
  maxUpdates: 50,
  triggerEveryHours: 2,
  skipHours: {
    start: 1,
    end: 7,
  },
  excludedTaskLists: [],
  excludedTitleMarkers: ['[no-date]', '#someday'],
  targetFunctionName: 'setTodayForUndatedTasks',
};
```

`excludedTaskLists` にはタスクリストIDまたはタスクリスト名を指定できます。

`skipHours` はスクリプトのタイムゾーン基準です。上の設定では1時から7時まで、実更新関数はタスク一覧の取得や更新をせず終了します。

## CI

pull requestとpushで以下を実行します。

- `npm install`
- `npm run lint`
- `npm run syntax`

CIはGitHub Secretsがなくても動作します。
