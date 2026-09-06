/**
 * ④ データ更新。
 *
 * 「登録 → 更新 → 読み直して反映を確認 → 後片付け」までを1ステップにする。
 * 更新系は 200 が返っただけでは検証にならないので、
 * PATCH のレスポンスと、そのあと GET し直した値の両方で
 * 期待値と一致することを確認する。
 *
 * config の updateVerifyMode:
 *   "patch"       … 登録 → 更新 → 再取得 → 削除まで実施
 *   "create-only" … 登録のみ（公開デモの default ユーザーは PATCH/DELETE が
 *                   403 になるため、そこへ向けるときはこちら）
 */
import http from "k6/http";
import { check } from "k6";

import { params, jsonParams } from "../lib/http.js";
import {
  statusIs, statusIsOneOf, jsonHasFields, jsonFieldEquals, fasterThan
} from "../lib/checks.js";
import { recordStep } from "../lib/metrics.js";
import { safeJson, valueAt } from "../lib/util.js";

/**
 * @returns {boolean} 成功したか
 */
export default function updateRecord(config, token) {
  const settings = config.steps.update;
  let elapsed = 0;
  let ok = true;

  // --- 更新対象を1件作る ----------------------------------------------------
  const createTargetRes = http.post(
    `${config.apiBaseUrl}/api/pizza`,
    JSON.stringify({
      maxCaloriesPerSlice: 1000,
      mustBeVegetarian: false,
      excludedIngredients: [],
      excludedTools: [],
      maxNumberOfToppings: 4,
      minNumberOfToppings: 2
    }),
    jsonParams("POST /api/pizza", token)
  );
  elapsed += createTargetRes.timings.duration;
  // 注意: check() を先に評価させるため `check(...) && ok` の順で書く。
  // `ok && check(...)` にすると ok が false のときに検証が実行されない。
  ok = check(createTargetRes, {
    ...statusIs(200),
    ...jsonHasFields(["pizza.id"])
  }) && ok;

  const targetId = valueAt(safeJson(createTargetRes), "pizza.id");

  // --- 明細を登録 -----------------------------------------------------------
  const createRes = http.post(
    `${config.apiBaseUrl}/api/ratings`,
    JSON.stringify({ stars: settings.stars, pizza_id: targetId }),
    jsonParams("POST /api/ratings", token)
  );
  elapsed += createRes.timings.duration;
  ok = check(createRes, {
    ...statusIsOneOf([200, 201]),
    ...jsonHasFields(["id"]),
    ...jsonFieldEquals("stars", settings.stars)
  }) && ok;

  const recordId = safeJson(createRes).id;

  if (config.updateVerifyMode === "patch" && recordId !== undefined) {
    // --- 更新 ---------------------------------------------------------------
    const patchRes = http.patch(
      `${config.apiBaseUrl}/api/ratings/${recordId}`,
      JSON.stringify({ stars: settings.updatedStars }),
      // 可変IDを含むURLは name タグでまとめる。これをやらないと
      // ID の数だけメトリクスが増える
      jsonParams("PATCH /api/ratings/:id", token)
    );
    elapsed += patchRes.timings.duration;
    ok = check(patchRes, {
      ...statusIs(200),
      ...jsonFieldEquals("stars", settings.updatedStars)
    }) && ok;

    // --- 読み直して本当に反映されたかを確認 --------------------------------
    const verifyRes = http.get(
      `${config.apiBaseUrl}/api/ratings/${recordId}`,
      params("GET /api/ratings/:id", { token })
    );
    elapsed += verifyRes.timings.duration;
    ok = check(verifyRes, {
      ...statusIs(200),
      ...jsonFieldEquals("stars", settings.updatedStars),
      ...jsonFieldEquals("id", recordId)
    }) && ok;

    // --- 後片付け（次の反復に影響を残さない） ------------------------------
    if (settings.cleanup) {
      const deleteRes = http.del(
        `${config.apiBaseUrl}/api/ratings/${recordId}`,
        null,
        params("DELETE /api/ratings/:id", { token })
      );
      elapsed += deleteRes.timings.duration;
      ok = check(deleteRes, {
        ...statusIsOneOf([200, 204])
      }) && ok;
    }
  }

  // ステップ全体の所要時間は step_update の threshold（config.json）で見る。
  // ここで check を足しても二重になるだけなので置かない。
  recordStep("update", ok, elapsed);

  return ok;
}