/**
 * リクエストパラメータの組み立て。
 *
 * ポイントは `tags.name` を必ず付けること。k6 は既定でリクエストURLを
 * そのまま `name` タグにするため、/api/ratings/123 のような可変URLを
 * 実行するとURLの数だけメトリクスが増えてしまう。テンプレート形の名前を
 * 明示して集約する。
 *
 * 基本は "GET /api/ratings/:id" のようにメソッドとパスを書くが、
 * 接続先によってパスが変わるステップ（アップロード・ダウンロード）は
 * "POST upload" のような固定の論理名にしている。パスを名前に入れると
 * 環境ごとにメトリクスが分かれて比較できなくなるため。
 */

/**
 * @param {string} name メトリクス上の名前（例: "GET /api/ratings/:id"）
 * @param {Object} [options]
 * @param {string} [options.token] 認証トークン
 * @param {string} [options.contentType] Content-Type
 * @param {Object} [options.headers] 追加ヘッダ
 * @param {string} [options.responseType] "text" | "binary" | "none"
 * @param {string} [options.timeout] 例: "60s"
 * @param {Object} [options.tags] 追加タグ
 */
export function params(name, options = {}) {
  const headers = { ...(options.headers || {}) };

  if (options.token) {
    headers["Authorization"] = `Token ${options.token}`;
  }
  if (options.contentType) {
    headers["Content-Type"] = options.contentType;
  }

  const result = {
    headers,
    tags: { name, ...(options.tags || {}) }
  };

  if (options.responseType) result.responseType = options.responseType;
  if (options.timeout) result.timeout = options.timeout;

  return result;
}

/** JSON を送るとき用の短縮版 */
export function jsonParams(name, token, options = {}) {
  return params(name, { ...options, token, contentType: "application/json" });
}