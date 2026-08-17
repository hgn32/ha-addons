/**
 * アドオン設定 (/data/options.json) を quake-panel の環境変数へ変換し、
 * シェルが eval できる export 文として標準出力へ書き出す。
 *
 * 警告・エラーは標準エラーへ出す (標準出力は eval されるため)。
 * どちらも Home Assistant のログタブに出る。
 */
import { readFileSync } from 'node:fs';

const OPTIONS_PATH = process.env.OPTIONS_PATH ?? '/data/options.json';

/** 既定値は config.json の options と揃えること */
const DEFAULTS = {
  notify_home_assistant: true,
  kmoni_layer: 'acmap',
  kmoni_idle_frame_interval_sec: 1,
  kmoni_active_frame_interval_sec: 1,
  log_level: 'info',
};

let raw;
try {
  raw = readFileSync(OPTIONS_PATH, 'utf8');
} catch (error) {
  // Home Assistant の外 (手元での確認など) では options.json が無い。
  // 既定値で動かせた方が都合がよいので、警告だけ出して続行する。
  warn(`${OPTIONS_PATH} を読めませんでした (${message(error)})。既定値で起動します。`);
  raw = null;
}

let options = {};
if (raw !== null) {
  try {
    options = JSON.parse(raw);
  } catch (error) {
    // HA が検証済みのはずのファイルが壊れている。既定値で黙って動かすと
    // 「設定したのに反映されない」になるため、ここで止める。
    fail(`${OPTIONS_PATH} を JSON として読めませんでした: ${message(error)}`);
  }
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    fail(`${OPTIONS_PATH} の中身がオブジェクトではありません。`);
  }
}

const notify = flag('notify_home_assistant');
// パネル -> ha-bridge の webhook。コンテナ内だけで閉じるので公開しない。
const BRIDGE_PORT = 8099;

const env = {
  // 緊急地震速報の送り先。パネルはここへ POST するだけで HA を知らない。
  // 通知を切るときは空にする (空ならパネルは webhook を作らない)。
  EEW_WEBHOOK_URL: notify ? `http://127.0.0.1:${BRIDGE_PORT}/eew` : '',
  // 以下は ha-bridge.mjs だけが読む。パネル本体はもう HA を触らない。
  BRIDGE_NOTIFY: notify ? 'true' : 'false',
  BRIDGE_PORT: String(BRIDGE_PORT),
  HA_API_URL: 'http://supervisor/core/api',
  KMONI_LAYER: text('kmoni_layer'),
  KMONI_IDLE_FRAME_INTERVAL_SEC: String(number('kmoni_idle_frame_interval_sec')),
  KMONI_ACTIVE_FRAME_INTERVAL_SEC: String(number('kmoni_active_frame_interval_sec')),
  LOG_LEVEL: text('log_level'),
};

for (const [key, value] of Object.entries(env)) {
  process.stdout.write(`export ${key}=${quote(value)}\n`);
}

/** 設定値が無い/型が違うときは既定値へ落とし、理由をログへ残す */
function pick(key, ok) {
  const value = options[key];
  if (value === undefined || value === null || value === '') return DEFAULTS[key];
  if (!ok(value)) {
    warn(`設定 ${key} の値が不正です (${JSON.stringify(value)})。既定値 ${JSON.stringify(DEFAULTS[key])} を使います。`);
    return DEFAULTS[key];
  }
  return value;
}

function text(key) {
  return String(pick(key, (v) => typeof v === 'string'));
}

function flag(key) {
  return pick(key, (v) => typeof v === 'boolean') === true;
}

function number(key) {
  return pick(key, (v) => typeof v === 'number' && Number.isFinite(v));
}

/** シェルの単一引用符で括る。中の ' は '\'' で閉じ直す。 */
function quote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

function warn(text) {
  process.stderr.write(`[quake-panel] 警告: ${text}\n`);
}

function fail(text) {
  process.stderr.write(`[quake-panel] エラー: ${text}\n`);
  process.exit(1);
}
