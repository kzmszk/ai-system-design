> 現在の定期採点はHermesの共通ジョブ処理です。日本時間8:00〜23:59、5分ごとに取得します。構成・APIは [共通LLMジョブ](https://github.com/kzmszk/hermes-llm-jobs) を参照してください。以下の毎時Codex採点・OpenAI API採点の記載は旧方式／代替方式です。

# AI Design Compass

[AI System Design](https://github.com/amitshekhariitbhu/ai-system-design) の主要テーマを8分野に整理した、日本語の適応型学習診断です。Cloudflare Workers + D1で動作し、メールの確認コードでログインします。

## 診断の流れ

1. **選択式8問**：全8分野を1問ずつ確認。最近の正答状況から次の問題の難度を調整します。
2. **絞り込み4〜8問**：理解があいまいな分野・復習候補を優先。9問目と11問目に記述式を出します。
3. **Codexで採点**：問題・模範解答・3つの採点観点・回答を送り、各観点を0〜2点で採点。点数と日本語の講評をDBへ保存します。
4. **終了判断**：通常12〜16問。12問以降は必要な記述の採点を待ち、追加確認が必要なら出題を続けます。
5. **結果と復習**：分野別の理解の手がかり、復習候補、追加確認の必要性を表示。診断履歴から回答と解説を見返せます。

問題集は基礎・応用・設計の3段階、計72問（選択48問・記述24問）。回答ごとに保存し、再ログイン後も続きから再開できます。

### 適応型出題について

分野ごとに仮の能力分布を持ち、採点済みの回答で更新します。選択式は偶然正解する確率0.25、記述式は証拠の重み0.8を設定。次の問題は期待される不確実性の減少を中心に、復習候補・出題済みの分野・負担を加味して選びます。同一分野は最大3問です。

最低12問で、良好な手がかりが揃った場合、広い基礎復習が必要な場合、または1〜2分野の弱点候補を追加確認できた場合に終了します。それ以外は最大16問です。途中終了もできます。

これは学習用の暫定診断です。問題の難度・出題モデルは実受験データによる校正前で、標準化されたCAT試験と同等の精度は保証しません。未回答や採点待ちは誤答として扱いません。LLMの自己申告confidenceが0.65未満、または5回の採点に失敗した回答は「採点要確認」として能力推定から除外します。confidenceは統計的に校正された正答確率ではありません。

## 構成

```text
ブラウザー → Worker（ログイン・出題・回答保存）→ D1
                      ↑
毎時のCodex → 採点APIで取得・処理権確保 → Codexが採点
                      ↓
                採点APIで点数・講評をD1へ保存
```

- `public/`：ログイン、診断、履歴、結果の画面。公開する静的ファイルはこのフォルダーだけ。
- `src/questions.js`：問題・正解・採点基準。回答中のブラウザーには正解を送りません。
- `src/adaptive.js`：難度調整、問題選択、終了条件。
- `src/auth.js`：メールOTP・Cookieセッション。Cloudflare Email Service / Resend対応。
- `src/attempts.js`：利用者ごとの診断と回答。二重送信・複数タブからの競合を制御。
- `src/grading.js`：記述回答の取得・リース・採点保存API。
- `src/grader-client.js`：OpenAI Responses API、JSON Schemaによる構造化出力。
- `scripts/grade.mjs`：外部のNode.jsから同じ採点APIを使う実行スクリプト。
- `migrations/`：D1のテーブル定義。

## ローカル起動

Node.js 22以降を使用します。

```sh
npm ci
npm run db:local
npm run dev
```

http://127.0.0.1:8787 を開きます。ローカル設定ではメールを送らず、画面に開発用コードを表示します。本番ではこのモードを使用できません。ローカル設定のダミーSecretは本番に使わないでください。

OpenAI採点をローカルで動かす場合は、`.grader.env.example` を `.grader.env` にコピーして `OPENAI_API_KEY` を設定し、次を実行します。実際のOpenAI利用料金が発生します。

```sh
npm run grade -- --watch
```

`.grader.env` はGitの対象外です。APIキーや回答全文はログに出しません。

## 本番の設定状況

公開URL: https://ai-design-compass.kazumasa.workers.dev

Worker・D1・メール認証は配置済みです。送信元は `AI Design Compass <login@fuchikoma.com>`。Resendのドメイン認証と送信専用キーの設定が完了しています。

2026-09-27から、記述はCodexのサブスク利用枠で採点する構成です。日本時間の毎日8:00〜23:00、毎正時にこのタスクの定期実行が未採点回答を最大50件取得し、1件ずつ採点して既存APIからD1へ保存します。PCとCodexアプリの起動が必要です。時間外・停止中・利用上限に達した間は採点待ちになり、次に実行できる時間帯に処理します。0時台の実行はありません。

実行手順は [SUBSCRIPTION-GRADING.md](SUBSCRIPTION-GRADING.md)、接続処理は `scripts/subscription-grade.py` です。`OPENAI_API_KEY` は不要で、Worker側の毎分のOpenAI採点Cronは停止しました。日次の期限切れログイン情報の整理は継続します。秘密の接続鍵はGit対象外の `.subscription-grader/` に保存します。

以下のOpenAI APIキーを使った手順は、将来API課金の自動採点へ切り替える場合の代替構成です。現行のサブスク採点には使いません。

## Cloudflareへの配置

対象アカウント：kazumasa@gmail.com。アカウントIDとDB IDは `wrangler.jsonc` に設定済みです。2026-09-26に本番D1を作成し、初期マイグレーションを適用しました。以下のDB作成手順は別環境へ配置する場合に使います。既存DBを再作成する必要はありません。

```sh
npx wrangler login
npx wrangler d1 create ai-design-compass
```

返された `database_id` を `wrangler.jsonc` の `d1_databases[0]` に設定してから、マイグレーションを適用します。

```sh
npm run db:remote
npx wrangler secret put OTP_SECRET
npx wrangler secret put GRADING_API_KEY
npx wrangler secret put OPENAI_API_KEY
```

`OTP_SECRET` と `GRADING_API_KEY` はそれぞれ異なるランダムな32バイト以上の値にします。キーは対話入力し、チャットやソースコードに貼らないでください。OpenAIモデルの初期値は `gpt-5.4-mini`。`OPENAI_MODEL` で変更できます。

### メール送信

**Cloudflare Email Serviceの場合**：Cloudflareの「Compute → Email Service → Email Sending」で送信ドメインを登録します。任意の利用者への送信にはWorkers Paidが必要です。契約・送信枠はダッシュボードで確認してください。

設定例（既存の設定に追加・変更）：

```json
{
  "send_email": [{ "name": "EMAIL" }],
  "vars": {
    "APP_ENV": "production",
    "MAIL_DELIVERY_MODE": "cloudflare",
    "MAIL_FROM": "login@your-verified-domain.example",
    "OPENAI_MODEL": "gpt-5.4-mini"
  }
}
```

**Resendの場合**：Resendで送信ドメインを認証し、`MAIL_DELIVERY_MODE` を `resend`、`MAIL_FROM` を認証済みドメインの送信元に設定します。

```sh
npx wrangler secret put RESEND_API_KEY
```

必要な設定が揃ったら配置します。

```sh
npm run deploy
```

Workersの公開URLで誰でもログインを開始できます。メールコードの照合後に本人の回答へアクセスできます。毎分のCronが最大3件ずつ記述を採点します。複数の処理が重なっても、回答ごとのリースにより二重採点を防ぎます。

## 採点API

以下のすべてに `Authorization: Bearer <GRADING_API_KEY>` が必要です。通常のログインCookieでは利用できません。キーをブラウザーに渡さないでください。

| メソッド・パス | 用途 |
| --- | --- |
| `GET /api/grading/answers?limit=10` | 未採点回答を取得。最大50件。返されたカーソルは `after` に指定 |
| `POST /api/grading/answers/:id/claim` | 15分間の処理権を取得。問題・解答例・採点基準・回答・`leaseToken` が返る |
| `POST /api/grading/answers/:id/grade` | 採点結果を保存 |
| `POST /api/grading/answers/:id/fail` | 失敗を記録して再試行可能にする |

採点保存の本文例：

```json
{
  "leaseToken": "claimで返された値",
  "criteria": [
    {"index": 0, "points": 2, "feedback": "仕組みを説明できています。"},
    {"index": 1, "points": 1, "feedback": "条件の説明が不足しています。"},
    {"index": 2, "points": 0, "feedback": "制約に触れていません。"}
  ],
  "confidence": 0.9,
  "feedback": "仕組みの理解はあります。条件と制約を復習しましょう。",
  "model": "gpt-5.4-mini",
  "promptVersion": "compass-openai-rubric-v2"
}
```

合計点はサーバーが計算し、DBに0〜1へ正規化して保存します。画面では0〜6点で表示します。同じ結果の再送は冪等です。異なる結果の上書きは409になります。失敗APIは `leaseToken` と `reason`（`provider_unavailable` / `invalid_grade` / `grader_error`）を受け取ります。

外部採点スクリプトを本番で使う場合は `.grader.env` の `QUIZ_API_URL` と `GRADING_API_KEY` を本番のものにします。毎分のCronと共存できます。

## 保存と認証

D1にユーザーのメールアドレス、回答文、出題時点の問題、得点、講評、モデル名、採点基準の版を保存します。OTPは10分・最大5回の入力・1回限り。コードの平文を保存せずHMACで照合します。セッションは7日間で、トークンのハッシュを保存し、ブラウザーではHttpOnly / Secure / SameSite Cookieを使います。メール・IP・全体で送信回数を制限しています。

現在の定期採点ではCodexのタスクに問題文・模範解答・採点基準・回答文を渡します。API版を使う場合、OpenAIへ送るのもこれらの情報です。メールアドレスやDB上の利用者IDは送りません。ただし、回答文に利用者自身が書いた情報は送信対象になります。Responses APIには `store: false` を指定しています。これはOpenAIの全サービス上の保存を一律に無効にする設定ではありません。

## 以前の試作版

`dist/` と `AI理解度チェック.html` は、DBなし・記述の自己採点を使った以前の試作です。今回のWorkerはこれらを配信しません。`.openai/hosting.json` は過去のSites登録情報で、今回の配置先はCloudflare Workersです。

## 参考とライセンス

原典：Amit Shekhar / Outcome School, AI System Design（Apache License 2.0）。問題は日本語で再構成しています。正解は概念理解を対象とし、製品の最新価格・上限の暗記を求めません。

- [Cloudflare D1](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Cloudflare Email Service](https://developers.cloudflare.com/email-service/get-started/send-emails/)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

## 再受験と結果の振り返り

同じ利用者が過去に正解した選択問題、満点（6/6点）を取った記述問題は、別の診断では出題候補から除きます。採点待ち・採点要確認・未回答・部分点は除外しません。今回の理解度は今回の回答から算出し、過去の点数を今回の点数に加算しません。

希望する難度の問題が残っていなければ近い難度を選びます。選択問題が残っていない分野は初期確認から外し、選択問題がすべて正解済みなら記述から始めます。出題可能な問題が尽きれば12問未満でも終了し、未採点の記述があれば採点を待ちます。全問正解済みなら0問で終了し、その旨を表示します。

結果画面には問題、自分の回答、正解・解答例、解説を展開して表示します。選択問題48問の誤答選択肢ごとに理由を用意し、選択肢が並べ替えられていても対応する解説を表示します。過去の診断にも表示できます。記述式は観点別の講評と満点への改善点を表示します。既存の採点結果は保存済みの講評を使い、新しい採点から改善点を明示する指示を適用します。

## 出題条件の選択

診断開始画面で難易度（自動調整、Lv.1基礎、Lv.2応用、Lv.3設計・上級）とカテゴリを選べます。カテゴリはチェックボックスで複数選択し、最低1つ必要です。指定レベルでは他のレベルへ移らず、選択したカテゴリのみ出題・診断します。正解済み除外で問題がなくなった場合は条件変更を案内します。出題条件は診断ごとにD1へ保存され、中断後も維持されます。進行中の診断は既存条件で再開し、新しい条件は次の診断に適用します。既存の診断は全カテゴリ・自動調整として扱います。

## 独立ジョブサービスとの連携

採点は独立した `hermes-llm-jobs` Workerと専用D1に依頼します。共通サービスのコードは別リポジトリ https://github.com/kzmszk/hermes-llm-jobs で管理します。

`LLM_JOBS` Service Bindingで公開APIと同じHTTP契約を呼び、Secret `LLM_JOBS_API_KEY` でクイズ専用アプリとして認証します。回答と `quiz_job_outbox` を同時保存し、送信失敗時は再送します。結果は5分ごとのCloudflare Cronまたは診断画面の読み込み時に同期します。採点そのものを実行するのはPC側のHermes cronです。

旧 `llm_jobs` / `llm_apps` テーブルは保管用で、実行コードは利用しません。旧 `/api/jobs` は廃止しました。クイズの回答・点数・ユーザー情報はクイズ専用D1に残ります。新しいローカル環境でもmigration 0004まで適用してください。
