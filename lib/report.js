/**
 * handleSummary() で HTML と JSON のレポートを書き出す。
 *
 * k6 は handleSummary() の戻り値を「ファイル名 → 中身」のマップとして扱い、
 * そのままファイルに書いてくれる（"stdout" / "stderr" も指定できる）。
 * つまり外部ライブラリを実行時に import しなくても、自分でHTMLを組める。
 *
 * 自作している理由は主に1つ:
 *   しきい値（thresholds）の合否を表として見せたいから。
 *   数字の羅列を渡して読み手に判断させるのではなく、
 *   開いた時点でどの条件を満たしていないかが分かる状態にしたい。
 *
 * k6公式の web dashboard を使う手もある（コード不要）:
 *   K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=report.html k6 run script.js
 * こちらは時系列グラフが出る。用途に応じて併用すればよい。
 *
 * --- 対象とするサマリ形式 ---
 * このサンプルは k6 v1.x の既定サマリ（legacy = root_group / metrics）だけを扱う。
 * v1.5 以降は `--new-machine-readable-summary` で別形式にもできるが、その形式には
 * しきい値の合否が含まれない（実測で確認）ため、合否を表にできない。
 * 中途半端に読み替えて「合格」と誤表示するより、非対応と明示して
 * k6 の終了コードへ誘導する。k6 自体はどちらの形式でもしきい値を評価するので、
 * CI での合否判定は影響を受けない。
 */
import { timestamp } from "./util.js";

/**
 * シナリオ側から呼ぶ入口。
 * 環境名や出力先は config から埋めるので、各シナリオは
 * 「レポートの題名」と「今回の負荷モデル」だけを渡せばよい。
 *
 * @param {Object} data k6 が渡してくる集計済みデータ
 * @param {Object} config config/config.js の CONFIG
 * @param {Object} scenario 実行した scenario 定義（options.scenarios の中身）
 * @param {string} [titleSuffix] 題名に付け足す文字列（例: "（疎通確認）"）
 */
export function summaryFor(data, config, scenario, titleSuffix = "") {
  return buildSummaryOutputs(data, {
    title: `${config.report.title}${titleSuffix}`,
    dir: config.report.dir,
    environmentName: config.environmentName,
    apiBaseUrl: config.apiBaseUrl,
    load: scenario
  });
}

/**
 * @param {Object} data k6 が渡してくる集計済みデータ
 * @param {Object} context レポートに載せる補足情報
 * @returns {Object} ファイル名 → 中身
 */
function buildSummaryOutputs(data, context) {
  const ts = timestamp();
  const dir = (context.dir || "reports").replace(/\/+$/, "");
  const summary = normalize(data);

  const result = {};

  // handleSummary() を定義すると k6 標準のコンソールサマリは出なくなる。
  // "stdout" キーを返して自分で最低限の要約を出す。
  // （公式の textSummary は jslib からのリモート import になるので使わない）
  result["stdout"] = renderTextSummary(summary, context, ts, dir);
  result[`${dir}/${ts}_report.html`] = renderHtml(summary, context, ts);
  result[`${dir}/${ts}_summary.json`] = JSON.stringify(data, null, 2);
  return result;
}

// --- サマリの正規化 ----------------------------------------------------------

/** k6 が渡してくるデータを表示用の形に均す */
function normalize(data) {
  // 非対応の形式（--new-machine-readable-summary）。
  // 読み替えはせず、判定できないことだけを伝える。
  if (data && data.results) {
    return {
      formatName: "machine-readable",
      metrics: {},
      checks: [],
      thresholds: [],
      thresholdsAvailable: false,
      runSeconds: (data.config && data.config.duration) || 0
    };
  }

  // k6 v1.x の既定（legacy）
  return {
    formatName: "legacy",
    metrics: data.metrics || {},
    checks: collectChecks(data.root_group || {}),
    thresholds: collectThresholds(data.metrics || {}),
    thresholdsAvailable: true,
    runSeconds: ((data.state && data.state.testRunDurationMs) || 0) / 1000
  };
}

// --- 集計 --------------------------------------------------------------------

/** しきい値の合否を平坦なリストにする（旧形式のみ） */
function collectThresholds(metrics) {
  const rows = [];

  for (const [metricName, metric] of Object.entries(metrics)) {
    if (!metric.thresholds) continue;

    for (const [expression, verdict] of Object.entries(metric.thresholds)) {
      // k6 のバージョンにより { ok: true } と true の両方がありうる
      const ok = typeof verdict === "object" && verdict !== null
        ? verdict.ok !== false
        : verdict !== false;
      rows.push({ metricName, expression, ok });
    }
  }

  // 失敗を上に持ってくる
  rows.sort((a, b) => Number(a.ok) - Number(b.ok));
  return rows;
}

/** グループを再帰的にたどって check を集める（旧形式のみ） */
function collectChecks(group, prefix = "") {
  const path = group.name ? `${prefix}${group.name}` : prefix;
  let rows = (group.checks || []).map((c) => ({
    group: path || "(root)",
    name: c.name,
    passes: c.passes || 0,
    fails: c.fails || 0
  }));

  for (const child of group.groups || []) {
    rows = rows.concat(collectChecks(child, path ? `${path} :: ` : ""));
  }
  return rows;
}

const STEP_LABELS = {
  login: "① ログイン",
  upload: "② ファイルアップロード",
  fetch: "③ データ取得",
  update: "④ データ更新",
  download: "⑤ ダウンロード"
};

function collectSteps(metrics) {
  const rows = [];

  for (const [key, label] of Object.entries(STEP_LABELS)) {
    const trend = metrics[`step_${key}`];
    const rate = metrics[`step_${key}_success`];
    const failures = metrics[`step_${key}_failures`];
    if (!trend && !rate) continue;

    const v = (trend && trend.values) || {};
    const rv = (rate && rate.values) || {};

    // 1度も実行されていないステップ（config で無効化した等）は 0ms ではなく "-" にする。
    // Trend にサンプルが無いと avg などは 0 で返ってくるため、実行回数で判断する。
    const executed = (rv.passes || 0) + (rv.fails || 0);
    const hasSamples = executed > 0;

    rows.push({
      label,
      metric: `step_${key}`,
      samples: executed,
      successRate: hasSamples ? rv.rate : null,
      failures: (failures && failures.values && failures.values.count) || 0,
      avg: hasSamples ? v.avg : undefined,
      med: hasSamples ? v.med : undefined,
      p90: hasSamples ? v["p(90)"] : undefined,
      p95: hasSamples ? v["p(95)"] : undefined,
      max: hasSamples ? v.max : undefined
    });
  }
  return rows;
}

/** 全体の合否。しきい値情報が無いときは「合格」と言わない */
function verdictOf(summary) {
  if (!summary.thresholdsAvailable) {
    return {
      state: "unknown",
      label: "⚠ 非対応のサマリ形式です。合否は k6 の終了コードで判定してください"
    };
  }
  const failed = summary.thresholds.filter((t) => !t.ok).length;
  return failed === 0
    ? { state: "ok", label: "✅ すべてのしきい値を満たしました", failed: 0 }
    : { state: "ng", label: `❌ しきい値 ${failed} 件が未達`, failed };
}

// --- 表示ヘルパ --------------------------------------------------------------

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ms(value) {
  if (value === undefined || value === null) return "-";
  return value >= 1000
    ? `${(value / 1000).toFixed(2)} s`
    : `${value.toFixed(1)} ms`;
}

function percent(rate) {
  if (rate === undefined || rate === null) return "-";
  return `${(rate * 100).toFixed(2)}%`;
}

function describeLoad(load) {
  if (!load) return "-";
  if (load.stages) {
    const stages = load.stages
      .map((s) => `${s.duration} → ${s.target}`)
      .join(", ");
    return `${load.executor} [${stages}]`;
  }
  const parts = [];
  if (load.vus !== undefined) parts.push(`vus=${load.vus}`);
  if (load.duration !== undefined) parts.push(`duration=${load.duration}`);
  if (load.iterations !== undefined) parts.push(`iterations=${load.iterations}`);
  if (load.rate !== undefined) parts.push(`rate=${load.rate}/${load.timeUnit}`);
  return `${load.executor} (${parts.join(", ")})`;
}

// --- テキストサマリ（コンソール用）------------------------------------------

function pad(value, width) {
  const s = String(value);
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function padLeft(value, width) {
  const s = String(value);
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

function renderTextSummary(summary, context, ts, dir) {
  const metrics = summary.metrics;
  const steps = collectSteps(metrics);
  const failedChecks = summary.checks.filter((c) => c.fails > 0);
  const verdict = verdictOf(summary);

  const reqs = metrics.http_reqs && metrics.http_reqs.values;
  const failRate = metrics.http_req_failed && metrics.http_req_failed.values;
  const checkRate = metrics.checks && metrics.checks.values;

  const lines = [];
  lines.push("");
  lines.push(`  ${context.title}`);
  lines.push(`  環境: ${context.environmentName}  接続先: ${context.apiBaseUrl}`);
  lines.push(`  実行時間: ${summary.runSeconds.toFixed(1)}s`
    + `  リクエスト: ${reqs ? reqs.count : "-"}`
    + `  エラー率: ${failRate ? percent(failRate.rate) : "-"}`
    + `  check成功率: ${checkRate ? percent(checkRate.rate) : "-"}`);
  lines.push("");

  lines.push("  ステップ別 応答時間（成功したリクエストのみ）");
  // 見出しは半角のみ。全角を混ぜると等幅フォントでも桁がずれる
  lines.push(`    ${pad("step", 16)}${padLeft("success", 9)}${padLeft("avg", 11)}${padLeft("p(95)", 11)}${padLeft("max", 11)}`);
  for (const s of steps) {
    lines.push(`    ${pad(s.metric, 16)}${padLeft(percent(s.successRate), 9)}`
      + `${padLeft(ms(s.avg), 11)}${padLeft(ms(s.p95), 11)}${padLeft(ms(s.max), 11)}`);
  }
  lines.push("");

  if (summary.thresholdsAvailable) {
    lines.push("  しきい値");
    for (const t of summary.thresholds) {
      lines.push(`    ${t.ok ? "✓" : "✗"} ${pad(t.metricName, 24)} ${t.expression}`);
    }
  } else {
    lines.push(`  しきい値: 非対応のサマリ形式（${summary.formatName}）のため判定できません`);
  }
  lines.push("");

  if (failedChecks.length > 0) {
    lines.push("  失敗した check");
    for (const c of failedChecks) {
      lines.push(`    ✗ ${c.group} :: ${c.name}  (${c.fails} 件失敗)`);
    }
    lines.push("");
  }

  lines.push(`  結果: ${verdict.state === "ok" ? "すべてのしきい値を満たしました"
    : verdict.state === "ng" ? `しきい値 ${verdict.failed} 件が未達（k6 は非0で終了します）`
      : "判定不能（k6 の終了コードで確認してください）"}`);
  lines.push(`  レポート: ${dir}/${ts}_report.html`);
  lines.push("");

  return lines.join("\n");
}

// --- HTML --------------------------------------------------------------------

function renderHtml(summary, context, ts) {
  const metrics = summary.metrics;
  const thresholds = summary.thresholds;
  const checks = summary.checks;
  const steps = collectSteps(metrics);
  const verdict = verdictOf(summary);

  const reqs = metrics.http_reqs && metrics.http_reqs.values;
  const failRate = metrics.http_req_failed && metrics.http_req_failed.values;
  const checkRate = metrics.checks && metrics.checks.values;
  const iterations = metrics.iterations && metrics.iterations.values;
  const reqDuration = (metrics.http_req_duration && metrics.http_req_duration.values) || {};

  const verdictClass = verdict.state === "ok" ? "ok" : verdict.state === "ng" ? "ng" : "unknown";

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(context.title)} - ${escapeHtml(ts)}</title>
<style>
  :root {
    --bg: #ffffff; --fg: #1b1f24; --muted: #5c6773; --line: #d8dee4;
    --panel: #f6f8fa; --ok: #1a7f37; --ng: #cf222e; --warn: #9a6700; --accent: #0969da;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117; --fg: #e6edf3; --muted: #8d96a0; --line: #30363d;
      --panel: #161b22; --ok: #3fb950; --ng: #f85149; --warn: #d29922; --accent: #58a6ff;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2rem 1.5rem 4rem; background: var(--bg); color: var(--fg);
    font-family: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif;
    line-height: 1.6;
  }
  .wrap { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.1rem; margin: 2.5rem 0 .75rem; padding-bottom: .35rem; border-bottom: 1px solid var(--line); }
  .sub { color: var(--muted); font-size: .875rem; margin: 0 0 1.5rem; }
  .verdict {
    display: inline-flex; align-items: center; gap: .5rem; font-weight: 700;
    padding: .5rem 1rem; border-radius: 999px; font-size: 1rem; margin-bottom: 1.5rem;
    border: 2px solid currentColor;
  }
  .verdict.ok { color: var(--ok); }
  .verdict.ng { color: var(--ng); }
  .verdict.unknown { color: var(--warn); }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: .75rem; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: .85rem 1rem; }
  .card .k { color: var(--muted); font-size: .75rem; letter-spacing: .02em; }
  .card .v { font-size: 1.35rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; font-size: .875rem; }
  th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid var(--line); }
  th { color: var(--muted); font-weight: 600; white-space: nowrap; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:hover td { background: var(--panel); }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .85em; }
  .ok { color: var(--ok); font-weight: 700; }
  .ng { color: var(--ng); font-weight: 700; }
  .note { background: var(--panel); border: 1px solid var(--line); border-left: 4px solid var(--warn); border-radius: 6px; padding: .75rem 1rem; font-size: .875rem; }
  .meta { display: grid; grid-template-columns: max-content 1fr; gap: .25rem 1rem; font-size: .875rem; }
  .meta dt { color: var(--muted); }
  .meta dd { margin: 0; }
  footer { margin-top: 3rem; color: var(--muted); font-size: .8rem; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${escapeHtml(context.title)}</h1>
  <p class="sub">生成: ${escapeHtml(ts)} / 実行時間: ${summary.runSeconds.toFixed(1)} 秒 / サマリ形式: <code>${escapeHtml(summary.formatName)}</code></p>

  <div class="verdict ${verdictClass}">${escapeHtml(verdict.label)}</div>

  <div class="cards">
    <div class="card"><div class="k">総リクエスト</div><div class="v">${reqs ? reqs.count.toLocaleString() : "-"}</div></div>
    <div class="card"><div class="k">エラー率</div><div class="v">${failRate ? percent(failRate.rate) : "-"}</div></div>
    <div class="card"><div class="k">check 成功率</div><div class="v">${checkRate ? percent(checkRate.rate) : "-"}</div></div>
    <div class="card"><div class="k">反復回数</div><div class="v">${iterations ? iterations.count.toLocaleString() : "-"}</div></div>
    <div class="card"><div class="k">応答時間 p(95)</div><div class="v">${ms(reqDuration["p(95)"])}</div></div>
  </div>

  <h2>実行条件</h2>
  <dl class="meta">
    <dt>環境</dt><dd><code>${escapeHtml(context.environmentName)}</code></dd>
    <dt>接続先</dt><dd><code>${escapeHtml(context.apiBaseUrl)}</code></dd>
    <dt>負荷モデル</dt><dd><code>${escapeHtml(describeLoad(context.load))}</code></dd>
  </dl>

  <h2>しきい値の判定</h2>
  ${!summary.thresholdsAvailable ? `
  <p class="note">
    このテストは <code>${escapeHtml(summary.formatName)}</code> 形式のサマリで実行された。
    <strong>このサンプルが対応しているのは k6 v1.x の既定サマリだけ</strong>で、
    この形式にはしきい値の合否が含まれないため、ここでは判定も集計もできない。
    ただし k6 自体はしきい値を評価しており、未達なら終了コードが非0になる。
    合否はそちらで確認すること。<code>--new-machine-readable-summary</code> を外せば通常どおり表示される。
  </p>` : thresholds.length === 0 ? "<p>しきい値が設定されていません。</p>" : `
  <table>
    <thead><tr><th>結果</th><th>メトリクス</th><th>条件</th></tr></thead>
    <tbody>
      ${thresholds.map((t) => `
      <tr>
        <td class="${t.ok ? "ok" : "ng"}">${t.ok ? "✅ PASS" : "❌ FAIL"}</td>
        <td><code>${escapeHtml(t.metricName)}</code></td>
        <td><code>${escapeHtml(t.expression)}</code></td>
      </tr>`).join("")}
    </tbody>
  </table>`}

  <h2>ステップ別の応答時間</h2>
  <p class="sub">Trend には成功したリクエストのみを記録している。失敗は「失敗数」列を見る。</p>
  ${steps.length === 0 ? "<p>ステップのメトリクスがありません。</p>" : `
  <table>
    <thead>
      <tr>
        <th>ステップ</th><th class="num">実行数</th><th class="num">成功率</th><th class="num">失敗数</th>
        <th class="num">avg</th><th class="num">med</th><th class="num">p(90)</th><th class="num">p(95)</th><th class="num">max</th>
      </tr>
    </thead>
    <tbody>
      ${steps.map((s) => `
      <tr>
        <td>${escapeHtml(s.label)}<br><code>${escapeHtml(s.metric)}</code></td>
        <td class="num">${s.samples}</td>
        <td class="num ${s.successRate === 1 ? "ok" : s.successRate === null ? "" : "ng"}">${percent(s.successRate)}</td>
        <td class="num">${s.failures}</td>
        <td class="num">${ms(s.avg)}</td>
        <td class="num">${ms(s.med)}</td>
        <td class="num">${ms(s.p90)}</td>
        <td class="num">${ms(s.p95)}</td>
        <td class="num">${ms(s.max)}</td>
      </tr>`).join("")}
    </tbody>
  </table>`}

  <h2>レスポンス検証（check）</h2>
  ${checks.length === 0 ? "<p>check がありません。</p>" : `
  <table>
    <thead><tr><th>グループ</th><th>検証内容</th><th class="num">成功</th><th class="num">失敗</th><th class="num">成功率</th></tr></thead>
    <tbody>
      ${checks.map((c) => {
        const total = c.passes + c.fails;
        const rate = total === 0 ? null : c.passes / total;
        return `
      <tr>
        <td>${escapeHtml(c.group)}</td>
        <td>${escapeHtml(c.name)}</td>
        <td class="num">${c.passes}</td>
        <td class="num ${c.fails > 0 ? "ng" : ""}">${c.fails}</td>
        <td class="num ${rate === 1 ? "ok" : rate === null ? "" : "ng"}">${percent(rate)}</td>
      </tr>`;
      }).join("")}
    </tbody>
  </table>`}

  <h2>HTTP メトリクス</h2>
  <table>
    <thead><tr><th>メトリクス</th><th class="num">avg</th><th class="num">med</th><th class="num">p(90)</th><th class="num">p(95)</th><th class="num">max</th></tr></thead>
    <tbody>
      ${["http_req_duration", "http_req_waiting", "http_req_connecting", "http_req_sending", "http_req_receiving", "iteration_duration"]
        .filter((name) => metrics[name])
        .map((name) => {
          const v = metrics[name].values;
          return `
      <tr>
        <td><code>${escapeHtml(name)}</code></td>
        <td class="num">${ms(v.avg)}</td>
        <td class="num">${ms(v.med)}</td>
        <td class="num">${ms(v["p(90)"])}</td>
        <td class="num">${ms(v["p(95)"])}</td>
        <td class="num">${ms(v.max)}</td>
      </tr>`;
        }).join("")}
    </tbody>
  </table>

  <footer>
    k6 の <code>handleSummary()</code> で生成。外部CDNへの参照は無く、このHTML単体で完結する。
  </footer>
</div>
</body>
</html>
`;
}
