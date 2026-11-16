# k6-load-samples リポジトリ修正点

対象: https://github.com/monga3/k6-load-samples （main, 3コミット時点）
記事「k6でシナリオ型の性能テストを組む」との整合を取るために洗い出した修正点。影響の大きい順。

---

## 1. 読者が詰まる・誤解する（先に直す）

### 1-1. クイックスタートの clone URL が旧リポジトリ名

- **場所**: `README.md` クイックスタート
- **現状**:
  ```sh
  git clone https://github.com/<アカウント名>/k6-load-test-sample.git
  cd k6-load-test-sample
  ```
- **修正**:
  ```sh
  git clone https://github.com/monga3/k6-load-samples.git
  cd k6-load-samples
  ```

### 1-2. `config.local.json` が gitignore されていない

- **場所**: `.gitignore` / `config/config.js`
- **現状**: `config.js` の `loadOptionalLocalConfig()` が `config.local.json` を任意で読み、コメントに「gitignore 済み」とあるが、`.gitignore` は `reports/` しか除外していない。個人設定を誤ってコミットしうる
- **修正（どちらか）**:
  - 残す場合: `.gitignore` に `config/config.local.json` を追加し、`config/config.local.json.example` を置く
  - 使わない場合: `loadOptionalLocalConfig()` と `deepMerge()` の呼び出しを削除

### 1-3. `UPDATE_VERIFY_MODE=patch` の制約が書かれていない

- **場所**: `README.md` 環境変数表・ディレクトリ構成、`steps/updateRecord.js` ヘッダコメント
- **現状**: `patch`（登録→更新→再取得→削除）とだけ書かれているが、`public` では `default` ユーザーが PATCH/DELETE で 403 になるため動かない。ツリーの `updateRecord.js # 登録 → 更新 → 再取得で反映を検証 → 削除` も既定の `create-only` と食い違う
- **修正**:
  - 環境変数表に「`patch` はローカル QuickPizza ＋ `default` 以外のアカウントでのみ有効」と注記
  - ツリーの説明に「（既定は登録のみ）」を添える

### 1-4. 「接続先を選ぶ」が1択なのに切り替え前提の構成

- **場所**: `README.md`「接続先を選ぶ」、環境変数表の `ENVIRONMENT`
- **現状**: 表が `public` 1行しかないのに「切り替える」と説明し、「起動が必要なもの」「更新ステップ」列が残っている。`ENVIRONMENT` も「接続先環境（`public`）」の1択
- **修正（どちらか）**:
  - 見出しを「接続先」に変え、表を1行分の説明に簡素化する
  - ローカル QuickPizza 用の環境を追加し、`API_BASE_URL` / `FILE_BASE_URL` の差し替え手順を書く

### 1-5. LICENSE ファイルがない

- **場所**: リポジトリルート
- **現状**: README に「MIT」とあるが `LICENSE` が存在しない
- **修正**: `LICENSE` を追加（GitHub の Add file → Choose a license template）

---

## 2. 整合性（記事とコードの食い違いを残さない）

### 2-1. フォームフィールドの値が旧リポジトリ名

- **場所**: `steps/uploadFile.js`
- **現状**: `source: "k6-load-test-sample"`
- **修正**: `source: "k6-load-samples"`。記事 8-6 のコード例も同時に変更

### 2-2. `k6/experimental/csv` のバージョン表記が揃っていない

- **場所**: `lib/workflow.js` コメント
- **現状**: `k6/experimental/csv`（v1.7 では利用可、v0.53 では未提供）
- **修正**: README・記事と揃えて「v0.54 以降」に

### 2-3. `files.style` のコメントが `echo` のみ

- **場所**: `config/config.js` の `CONFIG.files` コメント
- **現状**: `"echo"` の説明のみ。`uploadFile.js` と README の `FILE_STYLE` 表には `json` もある。` * style:` の行のインデントもずれている
- **修正**:
  ```js
  /**
   * ファイルAPIの設定。
   * style: "echo" … リクエスト本文をそのまま返す（QuickPizza の /api/post）
   *        "json" … {filename, receivedBytes} を返すサーバ（バイト数まで突き合わせる）
   */
  ```

### 2-4. README に説明のない設定セクション

- **場所**: `README.md`「設定」
- **現状**: `config.json` の `checks.maxDurationMs`（各ステップの `fasterThan` の上限）と `report`（出力先・題名）が説明されていない
- **修正**: 「設定」に1項目ずつ追加。`maxDurationMs` は `thresholds` の `p(95)` と役割が紛らわしいので、「`maxDurationMs` は1リクエストごとの check の上限、`thresholds` は集計値の合否」と区別を書く

### 2-5. 環境が1つになって意味が薄れたコメント

- **場所**: `steps/downloadReport.js`
- **現状**: 「パスは環境ごとに違うのでテンプレートから組む」
- **修正**: 「接続先を差し替えたときにパスも変えられるように」程度に言い換え

---

## 3. 体裁（余裕があれば）

- [ ] `README.md` ディレクトリ構成の tree: `config/` 配下の最後が `├──` → `└──`
- [ ] `.gitignore` 末尾に改行を入れる
- [ ] `lib/util.js`: `randomBetween` の後の空行3つを1つに
- [ ] `lib/checks.js`: `bodySizeIs` 前後の余分な空行を削除
- [ ] GitHub の About（description / topics）を設定。topics は `k6`, `load-testing`, `performance-testing` など
- [ ] README「時系列グラフが欲しい場合」の「集計周期の3倍」に出典か実測条件を添える（記事 7-2 も同じ）

---

## チェックリスト

| # | 項目 | 状態 |
|---|---|---|
| 1-1 | clone URL を実URLに | [ ] |
| 1-2 | `config.local.json` を gitignore（または機能削除） | [ ] |
| 1-3 | `UPDATE_VERIFY_MODE=patch` の制約を注記 | [ ] |
| 1-4 | 「接続先を選ぶ」を1択前提に整理 | [ ] |
| 1-5 | `LICENSE` 追加 | [ ] |
| 2-1 | `source` フィールドを新リポジトリ名に | [ ] |
| 2-2 | csv モジュールのバージョン表記を統一 | [ ] |
| 2-3 | `files.style` コメントに `json` を追記 | [ ] |
| 2-4 | `checks.maxDurationMs` / `report` を README に追加 | [ ] |
| 2-5 | `downloadReport.js` コメントを言い換え | [ ] |
| 3 | 体裁（tree 記号・空行・About・出典） | [ ] |

1-1〜2-1 まで直せば、記事とリポジトリの内容は一致する。
