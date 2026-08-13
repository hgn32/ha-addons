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
  home_name: '宮崎県延岡市',
  home_lat: 32.582,
  home_lon: 131.665,
  tsunami_home_areas: ['宮崎県'],
  kmoni_idle_frame_interval_ms: 1000,
  kmoni_active_frame_interval_ms: 1000,
  quake_history_size: 12,
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

const env = {
  HOME_NAME: text('home_name'),
  HOME_LAT: String(number('home_lat')),
  HOME_LON: String(number('home_lon')),
  TSUNAMI_HOME_AREAS: list('tsunami_home_areas').join(','),
  KMONI_IDLE_FRAME_INTERVAL_MS: String(number('kmoni_idle_frame_interval_ms')),
  KMONI_ACTIVE_FRAME_INTERVAL_MS: String(number('kmoni_active_frame_interval_ms')),
  QUAKE_HISTORY_SIZE: String(number('quake_history_size')),
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

function number(key) {
  return pick(key, (v) => typeof v === 'number' && Number.isFinite(v));
}

function list(key) {
  const value = pick(key, (v) => Array.isArray(v) && v.every((item) => typeof item === 'string'));
  const items = [];
  for (const item of value) {
    const trimmed = item.trim();
    if (trimmed === '') continue;
    // 予報区名はカンマ区切りで渡すので、値にカンマが入っていると分割されてしまう
    if (trimmed.includes(',')) {
      warn(`設定 ${key} の "${trimmed}" はカンマを含むため無視します (1 行に 1 つ書いてください)。`);
      continue;
    }
    items.push(trimmed);
  }
  if (items.length === 0) {
    warn(`設定 ${key} が空です。既定値 ${JSON.stringify(DEFAULTS[key])} を使います。`);
    return DEFAULTS[key];
  }
  return items;
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
