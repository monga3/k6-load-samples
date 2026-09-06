/**
 * ③ データ取得（一覧）。
 *
 * 2本のGETを1ステップとして扱う例。所要時間は合計を記録する。
 * ステップの粒度は「画面を1つ開く」くらいで切ると読みやすい。
 */
import http from "k6/http";
import { check } from "k6";

import { params } from "../lib/http.js";
import {
  statusIs, jsonArrayAtLeast, fasterThan
} from "../lib/checks.js";
import { recordStep } from "../lib/metrics.js";

/**
 * @returns {boolean} 成功したか
 */
export default function fetchList(config, token) {
  const minItems = config.steps.fetch.expectMinItems;
  const maxMs = config.checks.maxDurationMs.fetch;

  // マスタ系の一覧
  const toolsRes = http.get(
    `${config.apiBaseUrl}/api/tools`,
    params("GET /api/tools", { token })
  );
  const toolsOk = check(toolsRes, {
    ...statusIs(200),
    ...jsonArrayAtLeast("tools", minItems),
    ...fasterThan(maxMs)
  });

  // 明細系の一覧（0件でも正常なので「配列であること」だけを見る）
  const ratingsRes = http.get(
    `${config.apiBaseUrl}/api/ratings`,
    params("GET /api/ratings", { token })
  );
  const ratingsOk = check(ratingsRes, {
    ...statusIs(200),
    ...jsonArrayAtLeast("ratings", 0),
    ...fasterThan(maxMs)
  });

  const ok = toolsOk && ratingsOk;
  recordStep(
    "fetch",
    ok,
    toolsRes.timings.duration + ratingsRes.timings.duration
  );

  return ok;
}