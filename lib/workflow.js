/**
 * シナリオ本体。load.js と smoke.js で共有する。
 *
 * ここに書いてある「init コンテキストでのデータ読み込み」が
 * JMeter の CSV Data Set Config に相当する部分。
 * k6 では読み込みが「テスト起動時に1回」で、
 * SharedArray に入れておけば全VUが同じメモリを参照する。
 */
import { group, sleep } from "k6";
import { SharedArray } from "k6/data";
import exec from "k6/execution";

import CONFIG from "../config/config.js";
import { randomBetween } from "./util.js";

import login from "../steps/login.js";
import uploadFile from "../steps/uploadFile.js";
import fetchList from "../steps/fetchList.js";
import updateRecord from "../steps/updateRecord.js";
import downloadReport from "../steps/downloadReport.js";

/**
 * アカウント一覧。init コンテキストで1回だけ読み、全VUで共有する。
 * ここを `open()` のまま各VUに持たせると、VU の数だけメモリを消費する。
 *
 * 形式は JSON。k6公式の Data parameterization は JSON を第一に示していて、
 * `JSON.parse(open())` だけで読めるためパーサが要らない。
 * CSV を読むには Papa Parse などの外部ライブラリか、
 * 組み込みの `k6/experimental/csv`（v1.7 では利用可、v0.53 では未提供）が要る。
 */
const DATA_FILE = __ENV.DATA_FILE || "../data/accounts.json";

const accounts = new SharedArray("accounts", () =>
  JSON.parse(open(DATA_FILE)).accounts
);

/**
 * アップロードするファイル。バイナリモード（"b"）で開くと ArrayBuffer になる。
 * open() は init コンテキスト専用。default 関数の中では呼べない。
 */
const uploadFileData = open(
  __ENV.UPLOAD_FILE || "../data/upload_sample.csv",
  "b"
);

/**
 * VU 番号からアカウントを割り当てる。
 * VU 数がアカウント数を超えても回るように剰余で回す。
 *
 * `__VU` でも同じことができるが、`k6/execution` の `vu.idInTest` は
 * 分散実行でもテスト全体で一意になるので、こちらを使う。
 * 反復ごとに別データを使いたいなら `exec.scenario.iterationInTest` を使う。
 */
function accountForCurrentVu() {
  return accounts[(exec.vu.idInTest - 1) % accounts.length];
}

/** 設定された範囲でランダムに待つ（実ユーザーの操作間隔を模す） */
function thinkTime() {
  const range = CONFIG.load.thinkTimeSeconds;
  if (!range || range.length !== 2) return;
  sleep(randomBetween(range[0], range[1]));
}

/**
 * 一連の業務フローを1回実行する。
 * group() で囲むと group_duration メトリクスが自動で出て、
 * 配下の check やリクエストに group タグが付く。
 * JMeter の Transaction Controller に相当する。
 */
export function runWorkflow() {
  const account = accountForCurrentVu();
  const steps = CONFIG.steps;
  let token = null;

  group("01_login", () => {
    if (!steps.login.enabled) return;
    token = login(CONFIG, account);
  });

  // ログインできなければ以降は実行しない。
  // 認証に失敗したまま続けると、401がすぐ返ってくる分、
  // 応答時間の平均が実際より良く見えてしまう。
  if (!token) return;

  thinkTime();

  group("02_upload", () => {
    if (!steps.upload.enabled) return;
    uploadFile(CONFIG, token, uploadFileData);
  });

  thinkTime();

  group("03_fetch", () => {
    if (!steps.fetch.enabled) return;
    fetchList(CONFIG, token);
  });

  thinkTime();

  group("04_update", () => {
    if (!steps.update.enabled) return;
    updateRecord(CONFIG, token);
  });

  thinkTime();

  group("05_download", () => {
    if (!steps.download.enabled) return;
    downloadReport(CONFIG, token);
  });
}