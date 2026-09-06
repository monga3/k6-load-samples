# k6 負荷テストサンプル

ログイン → ファイルアップロード → データ取得 → データ更新 → ダウンロード、という業務システムでよくある一連の流れを1本のシナリオにした k6 のサンプル。

- 設定は **JSON**（環境・負荷モデル・しきい値・ステップ）
- 結果は **HTML**（`handleSummary()` で自作。外部CDN参照なしの単一ファイル）
- レスポンス検証は **`check()`**、合否判定は **`thresholds`**
- 外部依存ゼロ。`npm install` も不要

---

## クイックスタート

必要なものは [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) だけ。Grafana の公開デモ API に対してそのまま動く。

**このサンプルは k6 v1.x 前提**（v1.7.1 で動作確認）。パッケージマネージャで入れると最新版が入るので、揃えたい場合は [GitHub Releases](https://github.com/grafana/k6/releases/tag/v1.7.1) からバイナリを落とす。展開して出てくる実行ファイル1つで動くので、既存の k6 と共存できる。

```sh
git clone https://github.com/<アカウント名>/k6-load-test-sample.git
cd k6-load-test-sample

# 疎通確認: 1VU × 1反復で全ステップの check が通るか見る
k6 run scenarios/smoke.js
```

レポートは `reports/YYYYMMDD_HHMMSS_report.html` に出る。

> 公開デモは共有環境なので、**本気の負荷をかけないこと**。このサンプルは疎通確認に使用してください。

> **リポジトリのルート（このREADMEがある場所）で実行すること。**
> `handleSummary()` の出力先は実行時のカレントディレクトリ基準で解決される。

`scenarios/load.js` は負荷試験用のシナリオです。公開デモ API は共有環境のため、負荷試験には使用しないでください。

---

## 接続先を選ぶ

`config/config.json` の `activeEnvironment`、または `--env ENVIRONMENT=...` で切り替える。

| 環境 | 向き先 | 起動が必要なもの | 更新ステップ | 用途 |
|---|---|---|---|---|
| `public`（既定） | [公開デモ QuickPizza](https://quickpizza.grafana.com) | **なし** | 登録のみ | クローンして即動く。疎通確認向け。**負荷はかけない** |

5ステップすべてが公開デモ API で完結する。Docker は不要。

### QuickPizza で使っているエンドポイント

`test.k6.io` と `httpbin.test.k6.io` は**廃止され**、現在は `quickpizza.grafana.com` にリダイレクトされる。旧ホストの httpbin 系エンドポイントは QuickPizza に取り込まれているので、ファイルの送受信もこれ1つで賄える。

| ステップ | エンドポイント |
|---|---|
| ログイン | `POST /api/users/token/login` |
| アップロード | `POST /api/post`（リクエスト本文をそのまま返す） |
| 取得 | `GET /api/tools` / `GET /api/ratings` |
| 更新 | `POST /api/pizza` → `POST /api/ratings` |
| ダウンロード | `GET /api/bytes/{n}`（指定バイト数を返す） |

他に `/api/delay/{d}`、`/api/headers`、`/api/json`、`/api/xml`、`/api/basic-auth/{u}/{p}`、`/flip_coin.php`、`/pi.php` もある。

### 注意: 公式デモAPIの制約

- **`default` ユーザーは `PATCH` / `DELETE` ができない**（`403 operation not permitted for default user`）。これは公開インスタンス固有の制限ではなく実装上の仕様で、`default` は「グローバルユーザー」として更新系が禁止されている（`pkg/model/user.go` の `GlobalUsername = "default"`、`pkg/database/catalog.go` の `ErrGlobalOperationNotPermitted`）。**ローカルで起動しても同じ**
  - 回避策は `POST /api/users` で `default` 以外のユーザーを登録してそのユーザーでログインすること（`User.Validate()` が `default` という名前を弾くので、登録ユーザーは必ず非グローバルになる）
  - ただし**公開インスタンスは状態が共有されていない**（登録が 201 でも直後のログインが 401 になる／作成したレコードのIDが別の内容を指す）。この方式が使えるのは単一のローカルインスタンスだけ
  - このため `public` の更新ステップは `create-only`（登録のみ）にしてある
- **`POST /api/post` のエコーは公開インスタンスでは数KBで切り詰められる**（34KB送信 → 応答3.7KB を実測）。ハンドラ自体は `io.Copy` で全量返す実装なので、切り詰めているのは前段のプロキシと思われる。そのため `style: "echo"` の環境ではバイト数一致ではなく「ファイル名とファイル本文の先頭が返ってきたか」を検証している
  - さらに **k6 は multipart のパートの並び順を保証しない**ので、末尾に来るかもしれないフォームフィールドの値は検証に使えない（大きなファイルパートが先に書かれた回だけ切り詰め位置より後ろに落ち、5回に1回ほど失敗した）

---

## 設定

### 負荷モデル

`config/config.json` の `load` を変えるだけ。JavaScript は触らない。

```json
{
  "load": {
    "executor": "ramping-vus",
    "stages": [
      { "duration": "10s", "target": 5 },
      { "duration": "30s", "target": 5 },
      { "duration": "5s",  "target": 0 }
    ],
    "gracefulStop": "10s",
    "thinkTimeSeconds": [0.5, 1.5]
  }
}
```

対応している executor: `shared-iterations` / `per-vu-iterations` / `constant-vus` / `ramping-vus` / `constant-arrival-rate` / `ramping-arrival-rate`。

### しきい値

満たさないと **k6 の終了コードが 0 以外になる**（CI はこれを見るので、そのままジョブの合否になる）。

```json
{
  "thresholds": {
    "http_req_failed": ["rate<0.01"],
    "checks": ["rate>0.99"],
    "checks{group:::04_update}": ["rate>0.99"],
    "group_duration{group:::04_update}": ["p(95)<3000"],
    "step_login": ["p(95)<2000"],
    "step_upload": ["p(95)<3000"],
    "step_fetch": ["p(95)<2000"],
    "step_update": ["p(95)<3000"],
    "step_download": ["p(95)<5000"]
  }
}
```

`checks` は全ステップを合算した成功率なので、1ステップだけ失敗しても薄まる。ステップ単位で見たいものは `checks{group:::NN_name}` のようにグループタグで絞る。

サンプルなので値は概算。実際のSLOに合わせて調整する。

> **注意:** 対象データが1件もないメトリクスのしきい値は、黙って PASS になる（`p(95)` が 0 として評価されるため）。
> ステップを無効化すると、そのステップのしきい値は必ず通る。レポートの「実行数」列も一緒に確認すること。
>
> グループタグを書き間違えた場合も同じで、存在しないグループ名を指定してもエラーにならず通ってしまう。
> 追加したら一度わざと落として `✗` が出ることを確認するのが確実。

### ステップの有効/無効

```json
{
  "steps": {
    "login":    { "enabled": true },
    "upload":   { "enabled": true, "filename": "accounts_upload.csv" },
    "fetch":    { "enabled": true, "expectMinItems": 1 },
    "update":   { "enabled": true, "stars": 3, "updatedStars": 5, "cleanup": true },
    "download": { "enabled": true, "bytes": 262144 }
  }
}
```

### テストデータ

アカウント一覧は init コンテキストで1回だけ読み、`SharedArray` で全VUに共有する。VU への割り当ては `k6/execution` の `vu.idInTest` を剰余で回す。

形式は **JSON**。k6公式の Data parameterization は JSON を第一に示していて、`JSON.parse(open())` だけで読めるためパーサが不要になる。CSV を読むには Papa Parse などの外部ライブラリが要る。

別のファイルを使いたい場合は `DATA_FILE` で差し替える。

```sh
k6 run --env DATA_FILE=../data/accounts_staging.json scenarios/load.js
```

大きなCSVをどうしても扱いたい場合は、組み込みの `k6/experimental/csv`（`csv.parse()` / `csv.Parser`）がある（v0.54 以降）。

### 環境変数での上書き

| 変数 | 効果 |
|---|---|
| `ENVIRONMENT` | 接続先環境（`public`） |
| `API_BASE_URL` / `FILE_BASE_URL` | 接続先を直接指定 |
| `FILE_STYLE` | アップロード応答の形式（`echo` / `json`） |
| `VUS` + `DURATION` | 指定すると `constant-vus` に切り替わる |
| `ITERATIONS` / `EXECUTOR` | executor と反復回数を上書き |
| `UPDATE_VERIFY_MODE` | `patch`（登録→更新→再取得→削除）/ `create-only` |
| `UPLOAD_FILE` | アップロードするファイルのパス |
| `DATA_FILE` | アカウント一覧のJSONファイル |

```sh
k6 run --env VUS=20 --env DURATION=3m scenarios/load.js
```

---

## ディレクトリ構成

```
.
├── config/
│   ├── config.json         # 環境・負荷モデル・しきい値・ステップ設定
│   ├── config.js           # ローダ（SharedArray で1回だけ読む / __ENV 上書き）
├── lib/
│   ├── options.js          # config.json → options.scenarios / thresholds
│   ├── checks.js           # 再利用する check 部品（8個）
│   ├── metrics.js          # ステップ別メトリクス（成功分のみ Trend に記録）
│   ├── http.js             # リクエストパラメータ（name タグ付与）
│   ├── report.js           # handleSummary → HTML + JSON + テキストサマリ
│   ├── workflow.js         # 一連のフロー（両シナリオで共有）
│   └── util.js             # 乱数・安全なJSON取得・タイムスタンプ
├── steps/                  # 1ステップ = 1ファイル
│   ├── login.js
│   ├── uploadFile.js       # http.file() で multipart 送信
│   ├── fetchList.js
│   ├── updateRecord.js     # 登録 → 更新 → 再取得で反映を検証 → 削除
│   └── downloadReport.js   # バイト数まで検証
├── scenarios/
│   ├── load.js             # 負荷試験用（config.json の負荷モデル）
│   └── smoke.js            # 疎通確認（1VU × 1反復）
├── data/
│   ├── accounts.json       # アカウント一覧（vu.idInTest で割り当て）
│   └── upload_sample.csv   # アップロード用（500行・約34KB）
└── reports/                # 出力先（gitignore）
```

## 対応するサマリ形式

`lib/report.js` が扱うのは **k6 v1.x の既定サマリだけ**。`--new-machine-readable-summary`（v1.5 以降のオプトイン）を付けると別形式になり、**その形式にはしきい値の合否が含まれない**。読み替えて中途半端に表示するより、レポートには `⚠ 判定不能` と出して終了コードへ誘導している。

k6 自体はどちらの形式でもしきい値を評価して終了コードに反映するので、CI の合否判定は影響を受けない。


## 時系列グラフが欲しい場合

k6 公式の web dashboard も併用できる（コード不要）。

```sh
K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=reports/dashboard.html \
  k6 run scenarios/load.js
```

実行中は `http://localhost:5665` で見られる。ただしレポートにグラフが入るのはテスト時間が集計周期の3倍を超えたときだけなので、短いスモークテストではグラフなしの HTML になる。

## ライセンス

MIT
