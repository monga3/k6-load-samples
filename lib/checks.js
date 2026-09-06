/**
 * 再利用できる check の部品。
 *
 * check() は「レスポンスが期待どおりか」を検証して記録するだけで、
 * 失敗してもテストは落ちない（k6公式: "failed checks do not cause the test
 * to abort or finish with a failed status"）。落としたいときは
 * thresholds（例: checks: ["rate>0.99"]）と組み合わせる。
 *
 * 各関数は check() にそのまま渡せるオブジェクトを返すので、
 * スプレッドで合成できる:
 *
 *   check(res, { ...statusIs(200), ...jsonHasFields(["token"]) });
 *
 * 注意: check の名前に「リクエストごとに変わる値」を入れてはいけない。
 * ここで名前に埋め込んでいるのは設定由来の固定値なので、
 * テスト1回のなかで名前の種類は増えない。
 */
import { safeJson, valueAt } from "./util.js";

/** ステータスコードの検証 */
export function statusIs(expected) {
  return {
    [`status is ${expected}`]: (r) => r.status === expected
  };
}

/** 複数の許容ステータス（作成が 200 でも 201 でも良い場合など） */
export function statusIsOneOf(expectedList) {
  const label = expectedList.join("/");
  return {
    [`status is ${label}`]: (r) => expectedList.includes(r.status)
  };
}

/** 所要時間の検証。SLO の当たりを取るのに使う */
export function fasterThan(ms) {
  return {
    [`duration < ${ms}ms`]: (r) => r.timings.duration < ms
  };
}

/** レスポンスJSONに必須フィールドが存在し、空でないこと */
export function jsonHasFields(paths) {
  return Object.fromEntries(
    paths.map((path) => [
      `has ${path}`,
      (r) => {
        const value = valueAt(safeJson(r), path);
        return value !== undefined && value !== null && value !== "";
      }
    ])
  );
}

/** レスポンスJSONの値が期待値と一致すること（更新が反映されたかの確認に使う） */
export function jsonFieldEquals(path, expected) {
  return {
    [`${path} equals expected`]: (r) => valueAt(safeJson(r), path) === expected
  };
}

/** 配列フィールドが指定件数以上であること */
export function jsonArrayAtLeast(path, minLength) {
  return {
    [`${path} is an array`]: (r) => Array.isArray(valueAt(safeJson(r), path)),
    [`${path} has >= ${minLength} items`]: (r) => {
      const value = valueAt(safeJson(r), path);
      return Array.isArray(value) && value.length >= minLength;
    }
  };
}

/** ボディのバイト数が完全一致すること（ダウンロードの欠損検知） */
export function bodySizeIs(bytes) {
  return {
    [`body size is ${bytes} bytes`]: (r) => bodyLength(r) === bytes
  };
}


/**
 * ボディに指定の文字列が含まれること。
 * ラベルは呼び出し側で付ける（中身そのものを名前に入れると
 * check 名が可変になってしまうため）。
 */
export function bodyContains(label, needle) {
  return {
    [`body contains ${label}`]: (r) =>
      typeof r.body === "string" && r.body.indexOf(needle) !== -1
  };
}


/**
 * ボディ長。responseType: "binary" のときは ArrayBuffer になるので
 * byteLength を見る必要がある。
 */
function bodyLength(res) {
  const body = res.body;
  if (body === null || body === undefined) return 0;
  if (typeof body === "string") return body.length;
  if (typeof body.byteLength === "number") return body.byteLength;
  return 0;
}