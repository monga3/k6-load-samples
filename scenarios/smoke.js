/**
 * 疎通確認用。1VU × 1反復だけ流して、全ステップの check が通るかを見る。
 *
 *   k6 run scenarios/smoke.js
 *
 * 負荷をかけるのが目的ではないので、しきい値は「check が全部通ること」だけ。
 * 本番の負荷試験の前にこれを通す習慣にすると、
 * 「シナリオのバグ」と「システムの性能問題」を切り分けやすい。
 */
import CONFIG from "../config/config.js";
import { summaryFor } from "../lib/report.js";
import { runWorkflow } from "../lib/workflow.js";

export const options = {
  scenarios: {
    smoke: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 1,
      maxDuration: "2m"
    }
  },
  thresholds: {
    checks: ["rate==1.0"],
    http_req_failed: ["rate==0.0"]
  }
};

export default function () {
  runWorkflow();
}

export function handleSummary(data) {
  return summaryFor(data, CONFIG, options.scenarios.smoke, "（疎通確認）");
}