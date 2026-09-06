/**
 * メインシナリオ: ログイン → アップロード → 取得 → 更新 → ダウンロード。
 *
 *   k6 run scenarios/load.js
 *   k6 run --env VUS=10 --env DURATION=1m scenarios/load.js
 *
 * 負荷モデル（VU数・ランプアップ）と しきい値は config/config.json 側にある。
 * このファイルは「何をするか」だけを持ち、「どれだけかけるか」は持たない。
 */
import CONFIG, { LOAD_OVERRIDES } from "../config/config.js";
import { buildOptions } from "../lib/options.js";
import { summaryFor } from "../lib/report.js";
import { runWorkflow } from "../lib/workflow.js";

export const options = buildOptions(CONFIG, LOAD_OVERRIDES);

export default function () {
  runWorkflow();
}

/** テスト終了時に HTML と JSON のレポートを書き出す */
export function handleSummary(data) {
  return summaryFor(data, CONFIG, options.scenarios.load);
}