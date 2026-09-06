/**
 * config.json の load セクションから k6 の options.scenarios を組み立てる。
 *
 * 負荷モデル（VU数・ランプアップ）を JSON 側に置くことで、
 * 「VUを増やす」「ランプアップを変える」といった変更でシナリオのコードを
 * 触らなくて済む。JMeter の Thread Group に相当する部分。
 *
 * やっていることは実質2つだけ:
 *   1. k6 のオプションではないキー（thinkTimeSeconds）を除く
 *   2. executor を切り替えたときに、その executor で使えないキーを落とす
 *      （例: constant-vus に stages を渡すと k6 が
 *        `json: unknown field "stages"` で起動に失敗する）
 *
 * executor 名そのものの妥当性は k6 が検証してくれる
 * （`unknown executor type '...'` と明示的に落ちる）ので、ここでは見ない。
 */

/** どの executor でも使えるキー */
const COMMON_KEYS = ["executor", "startTime", "gracefulStop", "tags", "env", "exec"];

/** executor ごとに固有のキー */
const EXECUTOR_KEYS = {
  "shared-iterations": ["vus", "iterations", "maxDuration"],
  "per-vu-iterations": ["vus", "iterations", "maxDuration"],
  "constant-vus": ["vus", "duration"],
  "ramping-vus": ["startVUs", "stages", "gracefulRampDown"],
  "constant-arrival-rate": ["rate", "timeUnit", "duration", "preAllocatedVUs", "maxVUs"],
  "ramping-arrival-rate": ["startRate", "timeUnit", "stages", "preAllocatedVUs", "maxVUs"]
};

/**
 * @param {Object} load config.json の load セクション
 * @param {Object} [overrides] --env VUS / DURATION / ITERATIONS / EXECUTOR による上書き
 */
function buildScenarios(load, overrides = {}) {
  const given = stripUndefined(overrides);

  // VUS と DURATION を両方指定されたら constant-vus と解釈する。
  // 「とりあえず1VUで10秒回す」を CLI から一発でやるための近道。
  if (given.vus !== undefined && given.duration !== undefined && !given.executor) {
    given.executor = "constant-vus";
  }

  const source = { ...load, ...given };
  const executor = source.executor;
  const allowed = COMMON_KEYS.concat(EXECUTOR_KEYS[executor] || []);

  const scenario = {};
  for (const key of allowed) {
    if (source[key] !== undefined) scenario[key] = source[key];
  }

  return { load: scenario };
}

/** config と overrides から options 全体を組み立てる */
export function buildOptions(config, overrides = {}) {
  return {
    scenarios: buildScenarios(config.load, overrides),
    thresholds: { ...config.thresholds },
    // 既定では p(90)/p(95) までなので、med と max も並べて見たい
    summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "max"]
  };
}

function stripUndefined(obj) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}