/**
 * 小さなユーティリティ。
 *
 * jslib.k6.io などのリモートモジュールを実行時に import すると、
 * 「テスト実行のたびに外部からコードを取得して実行する」ことになる。
 * この程度の処理は自前で持つ方が安全で、オフラインでも動く。
 */

/** min 以上 max 以下の実数を返す */
export function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}



/** レスポンスを JSON として安全に読む。非JSONや空ボディでも例外を投げない */
export function safeJson(res) {
  try {
    const parsed = res.json();
    return parsed === null || parsed === undefined ? {} : parsed;
  } catch (_e) {
    return {};
  }
}

/** ドット区切りのパスで値を取り出す（"pizza.id" など） */
export function valueAt(obj, path) {
  return path.split(".").reduce(
    (acc, key) => (acc === null || acc === undefined ? undefined : acc[key]),
    obj
  );
}

/** YYYYMMDD_HHMMSS 形式のタイムスタンプ */
export function timestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`
    + `_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}