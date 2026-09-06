/**
 * ⑤ ダウンロード。
 *
 * responseType: "binary" にすると body は ArrayBuffer になる。
 * バイト数を数えて欠損を検知したいので、ここでは本文を破棄しない。
 *
 * 逆に「サイズも中身も見ない大量ダウンロード」を投げるだけなら
 * options.discardResponseBodies = true（または responseType: "none"）で
 * メモリを節約できる。検証したいものに応じて使い分ける。
 */
import http from "k6/http";
import { check } from "k6";

import { params } from "../lib/http.js";
import { statusIs, bodySizeIs, fasterThan } from "../lib/checks.js";
import { recordResponse } from "../lib/metrics.js";

/**
 * @returns {boolean} 成功したか
 */
export default function downloadReport(config, token) {
  const bytes = config.steps.download.bytes;
  // パスは環境ごとに違うのでテンプレートから組む
  const path = config.files.downloadPath.replace("{bytes}", String(bytes));
  const url = `${config.files.baseUrl}${path}`;

  const res = http.get(
    url,
    params("GET download", {
      token,
      responseType: "binary",
      timeout: "120s"
    })
  );

  const ok = check(res, {
    ...statusIs(200),
    ...bodySizeIs(bytes),
    ...fasterThan(config.checks.maxDurationMs.download)
  });

  recordResponse("download", ok, res);

  return ok;
}