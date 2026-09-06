/**
 * ② ファイルアップロード（multipart/form-data）。
 *
 * ファイルの中身は init コンテキストで一度だけ open() して渡す。
 * VU ごとに読み直すと、VU の数だけメモリを消費し、測定対象より k6 が重くなる。
 *
 * 検証は「200 が返った」だけでは足りない。サーバの応答からファイル名と
 * 中身が本当に届いたことまで確認する。
 *
 * 応答の形はサーバによって違うので、config の files.style で切り替える。
 *   "echo" … リクエスト本文をそのまま返す（QuickPizza の POST /api/post）
 */
import http from "k6/http";
import { check } from "k6";

import { params } from "../lib/http.js";
import {
  statusIs, jsonFieldEquals, jsonHasFields, bodyContains, fasterThan
} from "../lib/checks.js";
import { recordResponse } from "../lib/metrics.js";

/**
 * @param {Object} config
 * @param {string} token
 * @param {ArrayBuffer} fileData open(path, "b") の戻り値
 * @returns {boolean} 成功したか
 */
export default function uploadFile(config, token, fileData) {
  const filename = config.steps.upload.filename;
  const expectedBytes = fileData.byteLength;
  const url = `${config.files.baseUrl}${config.files.uploadPath}`;

  const payload = {
    // 通常のフォームフィールドも同時に送れる
    source: "k6-load-test-sample",
    file: http.file(fileData, filename, "text/csv")
  };

  const res = http.post(
    url,
    payload,
    params("POST upload", { token, timeout: "120s" })
  );

  const ok = check(res, {
    ...statusIs(200),
    ...uploadPayloadChecks(config, filename, expectedBytes),
    ...fasterThan(config.checks.maxDurationMs.upload)
  });

  recordResponse("upload", ok, res);

  return ok;
}

/** サーバの応答形式ごとに、中身が届いたことの確認方法を切り替える */
function uploadPayloadChecks(config, filename, expectedBytes) {
  if (config.files.style === "echo") {
    // 送ったリクエスト本文がそのまま返るので、ファイル名とファイル本文の
    // 先頭が含まれることを見る。
    //
    // 応答の「全長」や「末尾にあるはずの値」は当てにしない。理由が2つある:
    //   1. QuickPizza のハンドラ自体は io.Copy で全量返すが、公開インスタンス
    //      では前段で数KBに切り詰められる（34KB送信 → 応答3.7KB を実測）
    //   2. k6 は multipart のパートの並び順を保証しない。大きなファイルパートが
    //      先に来ると、後続のフォームフィールドは切り詰め位置より後ろに落ちる
    // どちらもファイルパートの先頭付近は必ず残るので、そこだけを見る。
    return {
      ...bodyContains("filename", filename),
      ...bodyContains("file content", config.steps.upload.contentMarker)
    };
  }

  // JSON で受信結果を返すサーバ（バイト数まで突き合わせられる）
  return {
    ...jsonHasFields(["filename", "receivedBytes"]),
    ...jsonFieldEquals("filename", filename),
    ...jsonFieldEquals("receivedBytes", expectedBytes)
  };
}