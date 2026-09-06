/**
 * ① ログイン。
 *
 * トークンを取り出して以降のステップで使い回す。
 * JMeter の「正規表現抽出 → 変数に入れて後続で参照」に相当する部分が、
 * k6 では単なる JavaScript の戻り値になる。
 */
import http from "k6/http";
import { check } from "k6";
import exec from "k6/execution";

import { jsonParams } from "../lib/http.js";
import { statusIs, jsonHasFields, fasterThan } from "../lib/checks.js";
import { recordResponse } from "../lib/metrics.js";
import { safeJson } from "../lib/util.js";

/**
 * @returns {string|null} 認証トークン。失敗したら null
 */
export default function login(config, account) {
  const res = http.post(
    `${config.apiBaseUrl}/api/users/token/login`,
    JSON.stringify({ username: account.username, password: account.password }),
    jsonParams("POST /api/users/token/login")
  );

  const ok = check(res, {
    ...statusIs(200),
    ...jsonHasFields(["token"]),
    ...fasterThan(config.checks.maxDurationMs.login)
  });

  recordResponse("login", ok, res);

  // 接続そのものに失敗（status 0）したときだけ、原因の当たりを1回出す。
  // 毎VU・毎反復で出すとログが埋まるので最初の1回に絞る。
  if (res.status === 0 && exec.scenario.iterationInTest === 0) {
    console.error(
      `[接続失敗] ${config.apiBaseUrl} に到達できません（${res.error || "no response"}）。`
      + " 接続先が起動しているか確認してください。"
    );
  }

  return ok ? safeJson(res).token : null;
}