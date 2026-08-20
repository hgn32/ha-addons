/**
 * Quake Panel の Home Assistant 連携。
 *
 * パネル本体 (上流 hgn32/quake-panel) は HA を知らないまま動かし、
 * HA へ流す部分だけをこのプロセスが受け持つ。受け口は 2 つある。
 *
 *   緊急地震速報 : パネルの webhook (EEW_WEBHOOK_URL) を受ける。上流が
 *                  EewCoordinator の onEewEvent として用意した口で、
 *                  新規/続報/取消/表示終了が kind で明示される。デモ再生も
 *                  ここを通る。
 *   地震情報・津波: パネルの WebSocket に「ブラウザと同じ立場で」つなぐ。
 *                  この 2 つには webhook が無いため。
 *
 * 絞り込み (震度・地域) は持たない。HA 側のオートメーションで条件を
 * 書けば足りるため。
 *
 * 詳細は HA-INTEGRATION.md を参照。
 */
import { createServer } from 'node:http';

const WS_URL = process.env.PANEL_WS_URL ?? 'ws://127.0.0.1:8080/ws';
// パネルからの EEW webhook を受ける口。コンテナ内だけで完結させる。
const WEBHOOK_PORT = Number(process.env.BRIDGE_PORT ?? 8099);
const API_URL = (process.env.HA_API_URL ?? 'http://supervisor/core/api').replace(/\/$/, '');
const TOKEN = process.env.SUPERVISOR_TOKEN ?? '';
const REQUEST_TIMEOUT_MS = 4000;
// States API で作った状態は HA を再起動すると消えるので、定期的に入れ直す。
const STATE_REFRESH_MS = 60_000;
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

/** いま HA に見せている現況 */
let eew = null;
let tsunami = null;
let quake = null;
/** 同じ内容でイベントを流し続けないための記録 (続報は毎秒来る) */
let lastKey = { eew: '', tsunami: '', quake: '' };
/** 送信を 1 本にまとめる。並行に投げると古い状態が後から届いて上書きする */
let pushing = false;
let pushAgain = false;
/** 失敗のたびにログを埋めないよう、状態が変わったときだけ出す */
let failing = false;
let reconnectMs = RECONNECT_MIN_MS;

function log(text) {
  process.stdout.write(`[quake-panel][ha] ${text}\n`);
}
function warn(text) {
  process.stderr.write(`[quake-panel][ha] 警告: ${text}\n`);
}
function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

const INTENSITY_LABELS = new Map([
  [10, '1'], [20, '2'], [30, '3'], [40, '4'], [45, '5弱'],
  [46, '5弱以上'], [50, '5強'], [55, '6弱'], [60, '6強'], [70, '7'],
]);

function intensityLabel(scale) {
  return scale == null ? null : INTENSITY_LABELS.get(scale) ?? null;
}

// --- HA へ見せる中身 (エンティティ名・イベント名・属性名は上流のまま) ---

function eewData(state) {
  if (!state) return { active: false };
  return {
    active: !state.isCancel,
    id: state.id,
    is_demo: isDemo(state.id),
    alert: state.alert,
    is_warning: state.alert === 'warning',
    is_cancel: state.isCancel,
    is_training: state.isTraining,
    // 仮定震源要素 (P2P 556 の condition に「仮定」を含む報)。上流が電文の
    // 見分け方として挙げているので、そのまま渡して HA 側で除けるようにする。
    is_assumption: state.isAssumption,
    is_final: state.isFinal,
    report_number: state.reportNumber,
    max_intensity: intensityLabel(state.maxIntensity),
    hypocenter: state.hypocenter?.name,
    // 震源の緯度経度。地域別の予想震度がまだ無い第一報でも、HA 側で
    // distance() を使って「自宅からどれくらいか」で絞れるようにする。
    hypocenter_lat: state.hypocenter?.lat ?? null,
    hypocenter_lon: state.hypocenter?.lon ?? null,
    magnitude: state.hypocenter?.magnitude,
    depth_km: state.hypocenter?.depthKm,
    origin_time: state.originTime,
    // 予想震度が出ている地域と、その都道府県。オートメーションで
    // 「自分の県に関わるものだけ」と絞るために渡す。
    // kmoni の予報は地域別の予想震度を持たないので、第一報では空になる
    // (空を「該当なし」と扱うと第一報を落としてしまうので注意)。
    regions: (state.regions ?? []).map((region) => region.name),
    // 電文の値をそのまま渡す。緊急地震速報の pref は「宮崎」のように
    // 県が付かない表記で来る (地震情報の観測点は「宮崎県」と付く別語彙)。
    prefectures: [...new Set((state.regions ?? []).map((region) => region.pref).filter(Boolean))],
  };
}

function tsunamiData(state) {
  if (!state) return { active: false };
  const areas = state.areas ?? [];
  return {
    active: !state.cancelled && areas.length > 0,
    id: state.id,
    is_demo: isDemo(state.id),
    cancelled: state.cancelled,
    // 電文の予報区をそのまま渡す。名前だけに潰すと「宮崎県は注意報なのか
    // 大津波警報なのか」が分からなくなり、オートメーションで判定できない。
    // 予報区名は「宮崎県」と県が付く (緊急地震速報の pref は付かない別語彙)。
    areas,
  };
}

function quakeData(state) {
  if (!state) return {};
  return {
    id: state.id,
    is_demo: isDemo(state.id),
    max_intensity: intensityLabel(state.maxIntensity),
    hypocenter: state.hypocenter?.name,
    magnitude: state.hypocenter?.magnitude,
    depth_km: state.hypocenter?.depthKm,
    occurred_at: state.occurredAt,
    issue_type: state.issueType,
    domestic_tsunami: state.domesticTsunami,
  };
}

/**
 * 訓練報とキャンセル報では「発表中」にしない。オートメーションで
 * ダッシュボードを切り替える用途で、訓練で切り替わると困るため。
 */
function buildEntities() {
  const eewActive = eew !== null && !eew.isCancel && !eew.isTraining;
  const tsunamiActive = tsunami !== null && !tsunami.cancelled && (tsunami.areas ?? []).length > 0;
  return [
    {
      entityId: 'binary_sensor.quake_panel_eew',
      state: eewActive ? 'on' : 'off',
      attributes: { friendly_name: '緊急地震速報', icon: 'mdi:alert-octagon', ...(eew ? eewData(eew) : {}) },
    },
    {
      entityId: 'sensor.quake_panel_eew_intensity',
      state: (eewActive && intensityLabel(eew.maxIntensity)) || 'unknown',
      attributes: { friendly_name: '緊急地震速報の予想最大震度', icon: 'mdi:earth' },
    },
    {
      entityId: 'binary_sensor.quake_panel_tsunami',
      state: tsunamiActive ? 'on' : 'off',
      attributes: { friendly_name: '津波予報', icon: 'mdi:waves', ...(tsunami ? tsunamiData(tsunami) : {}) },
    },
    {
      entityId: 'sensor.quake_panel_last_quake',
      state: (quake && intensityLabel(quake.maxIntensity)) || 'unknown',
      attributes: { friendly_name: '最新の地震情報', icon: 'mdi:pulse', ...quakeData(quake) },
    },
  ];
}

// --- コア API への送信 ---

async function post(path, body) {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (failing) {
      failing = false;
      log('Home Assistant への送信が回復しました。');
    }
  } catch (error) {
    // 送れなくてもパネルの表示は続く。通知はあくまで付加機能なので落とさない。
    if (!failing) {
      failing = true;
      warn(`Home Assistant へ送れません: ${describe(error)}`);
    }
  }
}

function fire(eventType, data) {
  return post(`/events/${eventType}`, data);
}

/** センサーの入れ直し。流している間に状態が変わっていたら、もう 1 巡する。 */
async function pushStates() {
  if (pushing) {
    pushAgain = true;
    return;
  }
  pushing = true;
  try {
    do {
      pushAgain = false;
      for (const entity of buildEntities()) {
        await post(`/states/${entity.entityId}`, { state: entity.state, attributes: entity.attributes });
      }
    } while (pushAgain);
  } finally {
    pushing = false;
  }
}

// --- パネルからの受信 ---

function eewKey(state) {
  if (!state) return 'none';
  return [state.id, state.alert, state.maxIntensity ?? '-', state.isCancel, state.isFinal].join(':');
}
function tsunamiKey(state) {
  return state ? `${state.id}:${state.cancelled}` : 'none';
}

/** デモ再生で流れた電文か。id の接頭辞で分かる (上流 protocol.ts と同じ判定)。 */
function isDemo(id) {
  return typeof id === 'string' && id.startsWith('demo-');
}

/** WebSocket から受けるのは地震情報と津波だけ。EEW は webhook で受ける。 */
function handle(event) {
  switch (event.type) {
    // 接続直後の現況一括。つなぎ直したときにここへ戻ってくる。
    // 過去の発表でオートメーションを走らせないよう、イベントは流さず
    // センサーの値だけ現況に合わせる。
    case 'hello': {
      const snapshot = event.snapshot ?? {};
      eew = snapshot.eew ?? null;
      tsunami = snapshot.tsunami ?? null;
      quake = Array.isArray(snapshot.quakes) && snapshot.quakes.length > 0 ? snapshot.quakes[0] : null;
      lastKey = { eew: eewKey(eew), tsunami: tsunamiKey(tsunami), quake: quake?.id ?? '' };
      void pushStates();
      break;
    }
    case 'tsunami': {
      tsunami = event.tsunami ?? null;
      const key = tsunamiKey(tsunami);
      if (key !== lastKey.tsunami) {
        lastKey.tsunami = key;
        void fire('quake_panel_tsunami', tsunamiData(tsunami));
      }
      void pushStates();
      break;
    }
    case 'quake': {
      quake = event.quake ?? null;
      if (quake && quake.id !== lastKey.quake) {
        lastKey.quake = quake.id;
        void fire('quake_panel_quake', quakeData(quake));
      }
      void pushStates();
      break;
    }
    default:
      // eew は webhook で受ける。frame・health は HA へ流さない
      // (毎秒来るうえ自動化の役に立たない)。
      break;
  }
}

/**
 * パネルからの EEW webhook。
 * 本文は { type:'eew', kind:'new'|'update'|'cancel'|'expired', sentAt, eew }。
 * kind='expired' は続報が途切れて表示を終了したときなので、現況から消す。
 */
function handleEewWebhook(payload) {
  if (!payload || payload.type !== 'eew') return;
  const ended = payload.kind === 'expired';
  eew = ended ? null : payload.eew ?? null;
  // 続報は毎秒のように来る。意味が変わったときだけ HA へ流す。
  // 鍵に kind は入れない。同じ内容で kind だけ new→update と変わったときに
  // 二重に流れてしまうため。取消と表示終了は内容自体が変わるので取りこぼさない。
  const key = eewKey(eew);
  if (key !== lastKey.eew) {
    lastKey.eew = key;
    // 表示終了でも、どの地震が終わったのか (id・デモかどうか) は残す。
    // 発表中でないことは active で示す。
    const data = eewData(payload.eew ?? null);
    if (ended) data.active = false;
    void fire('quake_panel_eew', { ...data, kind: payload.kind });
  }
  void pushStates();
}

function startWebhookServer() {
  const server = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      // 受け取れなかったことをパネルへ伝えても再送はされないので、
      // 壊れた本文は握って 204 を返し、ログにだけ残す。
      try {
        handleEewWebhook(JSON.parse(body));
      } catch (error) {
        warn(`webhook の本文を読めません: ${describe(error)}`);
      }
      res.writeHead(204).end();
    });
  });
  server.on('error', (error) => warn(`webhook の受け口を開けません: ${describe(error)}`));
  server.listen(WEBHOOK_PORT, '127.0.0.1', () => {
    log(`緊急地震速報の webhook を待ち受けます (127.0.0.1:${WEBHOOK_PORT})。`);
  });
}

function connect() {
  const socket = new WebSocket(WS_URL);
  // error と close が続けて飛んでくるので、再接続の予約は 1 回だけにする
  let done = false;
  const retry = (reason) => {
    if (done) return;
    done = true;
    warn(`パネルとの接続が切れました (${reason})。${Math.round(reconnectMs / 1000)}秒後に繋ぎ直します。`);
    setTimeout(connect, reconnectMs);
    reconnectMs = Math.min(reconnectMs * 2, RECONNECT_MAX_MS);
  };

  socket.addEventListener('open', () => {
    reconnectMs = RECONNECT_MIN_MS;
    log(`パネルに接続しました (${WS_URL})。`);
  });
  socket.addEventListener('message', (event) => {
    let parsed;
    try {
      parsed = JSON.parse(String(event.data));
    } catch {
      return;
    }
    handle(parsed);
  });
  socket.addEventListener('error', () => retry('エラー'));
  socket.addEventListener('close', () => retry('切断'));
}

if (TOKEN === '') {
  // Supervisor がトークンを入れるので、通常は起きない。
  warn('SUPERVISOR_TOKEN がありません。Home Assistant へは送れません。');
}

log('Home Assistant 連携を開始します。');
startWebhookServer();
connect();
setInterval(() => void pushStates(), STATE_REFRESH_MS);
