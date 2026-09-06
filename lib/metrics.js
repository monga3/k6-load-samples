/**
 * ステップ単位のカスタムメトリクス。
 *
 * 設計上のポイントが2つある。
 *
 * 1. 応答時間（Trend）には「成功したリクエストだけ」を入れる。
 *    失敗したリクエストは 0ms 近くで返ってくることがあり、これを混ぜると
 *    平均やパーセンタイルが実態より速く見える。失敗は Rate と Counter で数える。
 *
 * 2. メトリクス名は固定。ステータスコードなどリクエストごとに変わる値を
 *    名前に埋め込むと、名前の種類が際限なく増えて集計できなくなる。
 */
import { Trend, Rate, Counter } from "k6/metrics";

/** シナリオで使うステップ名。thresholds のキーとそろえる */
const STEP_NAMES = ["login", "upload", "fetch", "update", "download"];

function defineStepMetrics(name) {
  return {
    // 成功したリクエストの所要時間のみ
    duration: new Trend(`step_${name}`, true),
    // 成功率（0〜1）
    success: new Rate(`step_${name}_success`),
    // 失敗回数
    failures: new Counter(`step_${name}_failures`)
  };
}

/**
 * ステップを無効化していても必ず全ステップ分を定義しておく。
 * config.json の thresholds は存在しないメトリクスを指すとエラーになるため。
 */
const stepMetrics = Object.fromEntries(
  STEP_NAMES.map((name) => [name, defineStepMetrics(name)])
);

/**
 * ステップの結果を記録する。
 *
 * @param {string} stepName STEP_NAMES のいずれか
 * @param {boolean} ok そのステップの check がすべて通ったか
 * @param {number} durationMs 所要時間（ミリ秒）
 * @param {Object} [tags] 追加タグ（account など）
 */
export function recordStep(stepName, ok, durationMs, tags = {}) {
  const metrics = stepMetrics[stepName];
  if (!metrics) {
    throw new Error(`未定義のステップ名です: ${stepName}`);
  }

  metrics.success.add(ok, tags);          // Rate: 成功率

  if (ok) {
    metrics.duration.add(durationMs, tags); // Trend: 応答時間（成功分のみ）
  } else {
    metrics.failures.add(1, tags);          // Counter: 失敗回数
  }
}

/**
 * 単一レスポンスのステップを記録するときの短縮版。
 * 複数リクエストからなるステップは合計時間を自分で渡す。
 */
export function recordResponse(stepName, ok, res, tags = {}) {
  recordStep(stepName, ok, res.timings.duration, tags);
}