/**
 * 設定ローダ。
 *
 * - config.json を SharedArray で「1回だけ」読み、全VUで共有する
 *   （open() は init コンテキストでしか呼べない。VU ごとに読み直すと VU の数だけ
 *    メモリと起動時間を無駄にする）
 * - config.local.json があれば上書き（gitignore 済み。個人の環境差はこちらへ）
 * - さらに環境変数（--env KEY=VALUE）で上書き。CI から差し込む用
 */
import { SharedArray } from "k6/data";

/** プレーンオブジェクトだけを再帰マージする（配列は置き換え） */
function deepMerge(base, override) {
  if (override === undefined || override === null) return base;
  if (Array.isArray(base) || Array.isArray(override)) return override;
  if (typeof base !== "object" || typeof override !== "object") return override;

  const merged = { ...base };
  for (const key of Object.keys(override)) {
    merged[key] = deepMerge(base[key], override[key]);
  }
  return merged;
}

function loadOptionalLocalConfig() {
  try {
    return JSON.parse(open("./config.local.json"));
  } catch (_e) {
    return {}; // 無くても良いファイル
  }
}

/** 数値の環境変数を安全に読む */
function envNumber(name) {
  const raw = __ENV[name];
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new Error(`環境変数 ${name} は数値で指定してください（実際の値: ${raw}）`);
  }
  return value;
}

const RAW_CONFIG = new SharedArray("config", () => {
  const base = JSON.parse(open("./config.json"));
  return [deepMerge(base, loadOptionalLocalConfig())];
})[0];

const environmentName = __ENV.ENVIRONMENT || RAW_CONFIG.activeEnvironment;
const environment = RAW_CONFIG.environments[environmentName];

if (!environment) {
  throw new Error(
    `環境 "${environmentName}" は config.json の environments にありません。`
    + `使えるのは: ${Object.keys(RAW_CONFIG.environments).join(", ")}`
  );
}

/** 実行時に使う確定済みの設定 */
export const CONFIG = {
  environmentName,
  apiBaseUrl: (__ENV.API_BASE_URL || environment.apiBaseUrl).replace(/\/+$/, ""),
  /**
   * ファイルAPIの設定。
  * style: "echo" … リクエスト本文をそのまま返す（QuickPizza の /api/post）
   */
  files: {
    baseUrl: (__ENV.FILE_BASE_URL || environment.files.baseUrl).replace(/\/+$/, ""),
    style: __ENV.FILE_STYLE || environment.files.style,
    uploadPath: environment.files.uploadPath,
    downloadPath: environment.files.downloadPath
  },
  updateVerifyMode: __ENV.UPDATE_VERIFY_MODE || environment.update.verifyMode,
  load: RAW_CONFIG.load,
  steps: RAW_CONFIG.steps,
  checks: RAW_CONFIG.checks,
  thresholds: RAW_CONFIG.thresholds,
  report: RAW_CONFIG.report
};

/** VU 数・所要時間を環境変数で手早く上書きするための値（options.js が使う） */
export const LOAD_OVERRIDES = {
  vus: envNumber("VUS"),
  duration: __ENV.DURATION,
  iterations: envNumber("ITERATIONS"),
  executor: __ENV.EXECUTOR
};

export default CONFIG;
