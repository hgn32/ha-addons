'use strict';

// Claude Session Opener のメインプロセス。以下をまとめて担当する。
//   1. アカウントごとの schedule_time になったら `claude -p "ok"` を実行するスケジューラ
//   2. Ingress 経由の認証用 Web UI（React + MUI のビルド済み静的ファイルを配信し、
//      画面の状態は Server-Sent Events で押し出す）
//   3. 実行が失敗したとき・トークンの期限が近いときの Home Assistant への通知
// 外部パッケージには依存せず Node.js 標準モジュールのみを使用する。
//
// ログは console.log/console.error のみで、ファイルには一切書かない。
// HA の「ログ」タブ（標準出力）で完結させ、無制限に増え続けるログファイルを
// 自前で持たないようにするため。
//
// アカウントの分離は $CLAUDE_CONFIG_DIR 環境変数で行う。Claude Code CLI は
// このディレクトリを設定・認証情報の保存先として使うため、アカウントごとに
// 別ディレクトリ（/data/claude-credentials/<slug>/）を割り当てれば、
// シンボリックリンクの貼り替えなしに複数アカウントを扱える。
//
// 認証は `claude setup-token` が発行する**1年有効**の長期トークンだけを使う
// （$CLAUDE_CODE_OAUTH_TOKEN として渡す）。`claude auth login` の認証情報は
// 有効期限が短く、毎朝の実行しかしないこのアドオンでは頻繁に切れてしまうため。
//
// 【通知の方針】
// 「実行できたか」と「トークンが有るか」は別物として扱う。実行が失敗したら
// トークンの有無に関わらず必ず通知する。トークンが読めないと黙って戻る作りに
// なっていたせいで、毎朝失敗し続けているのに通知が1件も出ない状態が実際に起きた。
// 通知を消すのは「実行が成功したとき」だけで、トークンの削除や再発行では消さない。

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8099;
const OPTIONS_PATH = '/data/options.json';
// 認証情報は /data 配下に保存する。/config（addon_config マップ）は
// 他のアドオン（File Editor, Samba 等）からも見える可能性がある共有領域なので、
// OAuth トークンの置き場所には向かない。/data はこのアドオン専用で他から
// アクセスされず、このアドオンを選んでバックアップすれば含まれる。
const CRED_ROOT = '/data/claude-credentials';
const TOKEN_FILE = 'oauth-token.json';
// フロントエンド（Vite でビルドした React + MUI）の出力先。
const PUBLIC_DIR = '/public';

const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
// コード本体を送ってから Enter(CR) を送るまでの間隔。
// 別の chunk として届かせるためのもので、0 でも通ったが、
// 端末側でまとめて読まれる可能性を消すために少し空ける。
const SUBMIT_ENTER_DELAY_MS = 200;
// コードを送ってから画面が変わらないまま放置される時間の上限。
// 超えたら入力待ちに戻して、やり直せる状態にする（固まったまま何もできない、を作らない）。
const SUBMIT_TIMEOUT_MS = 60 * 1000;
// `claude -p` が返らなくなったときの上限。超えたら kill して失敗として扱う。
const RUN_TIMEOUT_MS = 180 * 1000;
const HEARTBEAT_MS = 25 * 1000;
const SCHEDULER_TICK_MS = 20 * 1000;
// `claude setup-token` が発行するトークンの有効期間（公式ドキュメントで1年）。
// CLI は期限そのものを教えてくれないので、発行日時から自前で数える。
const TOKEN_LIFETIME_DAYS = 365;
// 残りこの日数を切ったら「そろそろ再発行を」と HA に通知する。
const TOKEN_WARN_DAYS = 14;
// setup-token 用の疑似端末のサイズ。トークン（100文字強）と認証 URL が
// 1行に収まるだけの幅を取る。
const PTY_COLS = 400;
const PTY_ROWS = 60;
// 疑似端末の出力を溜めすぎないための上限（末尾だけ残す）。
const FLOW_BUFFER_MAX = 64 * 1024;

// HA Core API は Supervisor のプロキシ経由で叩く。SUPERVISOR_TOKEN は
// Supervisor がコンテナへ自動注入する。config.json の homeassistant_api: true
// が無いと 401 になる。
const HA_BASE = 'http://supervisor/core';

// slug -> トークン発行フローの状態
const flows = new Map();
// slug -> 直近の実行結果
const runs = new Map();
// slug -> HA へ出した通知の状態
const healths = new Map();
// slug -> 画面に出す一時メッセージ
const notices = new Map();
// slug -> "YYYY-MM-DD HH:MM" (直近に発火した分。同じ分での二重発火を防ぐ)
const lastFiredMinute = new Map();

const clients = new Set();

// 直近の HA への通知送信が失敗していれば、その理由。画面にも出す
// （通知が届かないことに気付けないのが一番まずいため）。
let notifyProblem = '';
let noticeSeq = 0;

// console.log は HA の「ログ」タブにそのまま流れるが、
// run.sh 側の bashio::log と違って時刻が付かないため、自前で付与する。
function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}
function log(msg) { console.log(`[${ts()}] ${msg}`); }
function logError(msg) { console.error(`[${ts()}] ${msg}`); }

// 端末制御シーケンスを落とす。`claude setup-token` は Ink（対話 UI）なので、
// 出力には CSI / OSC / DCS が混ざる。CSI はプライベートパラメータ（< = > ?）付きの
// ものも来る（実測: `\x1b[>0q` `\x1b[?u` 等）ので、パラメータバイトは 0x30-0x3f
// をまとめて許す。ここを取りこぼすと画面文言の判定がずれる。
function stripAnsi(s) {
  return String(s == null ? '' : s)
    .replace(/\x1b[P^_][\s\S]*?(?:\x1b\\|\x07)/g, '')
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, '')
    .replace(/\x1b[()][@-~]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '');
}

// Ink は単語間を桁移動で描くので、エスケープを落とすだけだと単語が繋がる
// （"Paste code here" が "Pastecodehere" になる）。画面を組み立て直して
// 人が読める形に戻す。判定にも表示にもこちらを使う。
function renderScreen(raw) {
  const rows = [[]];
  let row = 0;
  let col = 0;
  const ensure = (r) => { while (rows.length <= r) rows.push([]); };
  const put = (ch) => {
    ensure(row);
    const line = rows[row];
    while (line.length < col) line.push(' ');
    line[col] = ch;
    col += 1;
  };
  const s = String(raw == null ? '' : raw);
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\x1b') {
      const next = s[i + 1];
      if (next === '[') {
        const m = /^\x1b\[([\x30-\x3f]*)([\x20-\x2f]*)([\x40-\x7e])/.exec(s.slice(i));
        if (!m) { i += 1; continue; }
        const nums = m[1].replace(/[<>=?]/g, '').split(';').map((x) => (x === '' ? 0 : parseInt(x, 10)));
        const n = nums[0] || 0;
        const cmd = m[3];
        if (cmd === 'A') row = Math.max(0, row - (n || 1));
        else if (cmd === 'B') row += (n || 1);
        else if (cmd === 'C') col += (n || 1);
        else if (cmd === 'D') col = Math.max(0, col - (n || 1));
        else if (cmd === 'E') { row += (n || 1); col = 0; }
        else if (cmd === 'F') { row = Math.max(0, row - (n || 1)); col = 0; }
        else if (cmd === 'G') col = Math.max(0, (n || 1) - 1);
        else if (cmd === 'H' || cmd === 'f') { row = Math.max(0, (nums[0] || 1) - 1); col = Math.max(0, (nums[1] || 1) - 1); }
        else if (cmd === 'J') {
          if (n === 2) { rows.length = 0; rows.push([]); row = 0; col = 0; }
          else { ensure(row); rows[row] = rows[row].slice(0, col); rows.length = row + 1; }
        } else if (cmd === 'K') {
          ensure(row);
          if (n === 0) rows[row] = rows[row].slice(0, col);
          else if (n === 1) { for (let k = 0; k < col && k < rows[row].length; k++) rows[row][k] = ' '; }
          else rows[row] = [];
        }
        i += m[0].length;
        continue;
      }
      if (next === ']' || next === 'P' || next === '^' || next === '_') {
        const end = /\x07|\x1b\\/.exec(s.slice(i + 2));
        i = end ? i + 2 + end.index + end[0].length : s.length;
        continue;
      }
      i += 2;
      continue;
    }
    if (ch === '\r') { col = 0; i += 1; continue; }
    if (ch === '\n') { row += 1; ensure(row); i += 1; continue; }
    if (ch === '\b') { col = Math.max(0, col - 1); i += 1; continue; }
    if (ch === '\t') { col += 8 - (col % 8); i += 1; continue; }
    if (ch < ' ' && ch !== ' ') { i += 1; continue; }
    put(ch);
    i += 1;
  }
  return rows.map((r) => r.join('').replace(/\s+$/, ''));
}

// 画面として読めるテキスト。診断表示にも使うのでトークンは伏せる。
// CLI の起動時ロゴ（ブロック文字の絵）は手がかりにならないので落とす。
function screenText(raw, lines = 14) {
  const rendered = renderScreen(raw)
    .filter((l) => l.trim())
    .filter((l) => !/^[\s\u2591\u2592\u2593\u2588\u2580\u2584*.\-_=]+$/.test(l));
  return maskSecrets(rendered.slice(-lines).join('\n'));
}

// 文言の判定は、組み立て直した画面と生の出力の両方を空白を畳んで見る。
// どちらか一方だけだと、描き方によって取りこぼす。
function flatten(s) {
  return (screenText(s, 40) + '\n' + stripAnsi(s)).replace(/\s+/g, '').toLowerCase();
}

// トークンの中身は base64url（A-Za-z0-9 と - _）と、末尾に = が付くことがある。
// 文字種を狭く取ると、末尾だけ落ちた「途中までのトークン」を保存してしまい、
// 毎朝の実行が 401 で失敗し続ける。取りこぼすより広めに取る。
const TOKEN_RE = /sk-ant-[A-Za-z0-9_\-=]{20,}/;

// ログにも画面にもトークンを出さないための保険。
function maskSecrets(s) {
  return String(s == null ? '' : s).replace(/sk-ant-[A-Za-z0-9_\-=]+/g, 'sk-ant-***');
}

function slugify(name, index) {
  const base = String(name || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return base || `account${index + 1}`;
}

function readOptions() {
  try {
    return JSON.parse(fs.readFileSync(OPTIONS_PATH, 'utf8'));
  } catch (e) {
    return {};
  }
}

function loadAccounts() {
  const raw = readOptions();
  const list = Array.isArray(raw.accounts) ? raw.accounts : [];
  const seenSlugs = new Set();
  return list
    .filter((a) => a && typeof a === 'object' && a.name && a.schedule_time)
    .map((a, i) => {
      let slug = slugify(a.name, i);
      while (seenSlugs.has(slug)) slug = `${slug}_${i}`;
      seenSlugs.add(slug);
      return { slug, name: String(a.name), scheduleTime: String(a.schedule_time) };
    });
}

function credDir(slug) {
  return path.join(CRED_ROOT, slug);
}

function findAccount(slug) {
  return loadAccounts().find((a) => a.slug === slug) || null;
}

// ログの行頭に出す表示名。設定から消えたアカウントでも slug で出す。
function accountLabel(slug) {
  const a = findAccount(slug);
  return a ? a.name : slug;
}

// --- 長期トークン（$CLAUDE_CODE_OAUTH_TOKEN） ---

function tokenPath(slug) {
  return path.join(credDir(slug), TOKEN_FILE);
}

// トークン本体は絶対にログへ出さない。戻り値を扱う側も同様。
function readToken(slug) {
  try {
    const j = JSON.parse(fs.readFileSync(tokenPath(slug), 'utf8'));
    if (!j || typeof j.token !== 'string' || !j.token) return null;
    return { token: j.token, createdAt: Number(j.createdAt) || 0 };
  } catch (e) {
    return null;
  }
}

function saveToken(slug, token) {
  const dir = credDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  const p = tokenPath(slug);
  fs.writeFileSync(p, JSON.stringify({ token, createdAt: Date.now() }), { mode: 0o600 });
  fs.chmodSync(p, 0o600);
}

function deleteToken(slug) {
  try { fs.unlinkSync(tokenPath(slug)); } catch (e) { /* もともと無ければ何もしない */ }
}

function tokenDaysLeft(rec) {
  if (!rec || !rec.createdAt) return null;
  return Math.floor(TOKEN_LIFETIME_DAYS - (Date.now() - rec.createdAt) / 86400000);
}

function looksLikeToken(s) {
  return /^sk-ant-[A-Za-z0-9_\-=]{20,}$/.test(String(s || '').trim());
}

// トークンの取り出しは**行単位**で行う。
// エスケープを落としただけの生テキストは、Ink が桁移動で描いた別の行の文字が
// 同じ行に並ぶことがあり、貪欲な正規表現がトークンの直後の単語まで飲み込む
// （実測: 直後の "Store this token securely." の "Store" が繋がって5文字長くなった）。
// 途中まで/余分に付いたトークンを保存すると、毎朝の実行が 401 で失敗し続け、
// しかも画面上は「保存しました」に見えるので気付けない。
// CLI はトークンを単独行で表示するので、まず「行全体がトークンの行」を採る。
function extractToken(text) {
  const lines = renderScreen(text);
  for (const line of lines) {
    const t = line.trim();
    const m = t.match(TOKEN_RE);
    if (m && m[0] === t) return t;
  }
  // 単独行で見つからないとき（例: export CLAUDE_CODE_OAUTH_TOKEN=... の行）は
  // その行の中の一致を採る。行をまたいで繋げることはしない。
  for (const line of lines) {
    const m = line.match(TOKEN_RE);
    if (m) return m[0];
  }
  // ここまでで見つからなければ「取り出せなかった」とする。
  // エスケープを落としただけの生テキストから拾うと、別の行の文字が繋がった
  // 誤ったトークンを保存してしまう。間違ったものを保存するより、
  // 取り出せなかったと伝えて手貼りに回ってもらう方が被害が小さい。
  return null;
}

// claude CLI を起動するときの環境変数。長期トークンがあればそれを使う
// （認証の優先順位で $CLAUDE_CODE_OAUTH_TOKEN は /login の認証情報より上）。
function claudeEnv(slug, { withToken = true } = {}) {
  const dir = credDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  const env = { ...process.env, CLAUDE_CONFIG_DIR: dir };
  const rec = withToken ? readToken(slug) : null;
  if (rec) env.CLAUDE_CODE_OAUTH_TOKEN = rec.token;
  else delete env.CLAUDE_CODE_OAUTH_TOKEN;
  return env;
}

// --- 画面に出す一時メッセージ ---

function setNotice(slug, kind, text) {
  noticeSeq += 1;
  notices.set(slug, { id: noticeSeq, kind, text });
}

function clearNotice(slug) {
  notices.delete(slug);
}

// --- 状態の入れ物 ---

function getFlow(slug) {
  if (!flows.has(slug)) {
    flows.set(slug, {
      proc: null,
      buffer: '',
      url: '',
      phase: 'idle',      // idle / starting / waiting / submitting / retrying / finishing
      error: '',
      urlRotated: false,  // エラー後に URL が発行し直された
      retrySent: false,
      tokenSaved: false,  // 画面にトークンが出た時点で保存したか
      runId: 0,           // 発行のたびに増やす。古いプロセスのイベントを捨てるため
      detectFrom: 0,      // 文言の判定をここから先だけで行う（前回の残りを拾わないため）
      screen: '',         // CLI の画面（診断用。トークンは伏せる）
      errorScreen: '',    // エラーが出た瞬間の画面（上書きされないように取っておく）
      timer: null,
      submitTimer: null,
    });
  }
  return flows.get(slug);
}

function getRun(slug) {
  if (!runs.has(slug)) {
    runs.set(slug, { running: false, at: '', ok: null, source: '', summary: '', detail: '' });
  }
  return runs.get(slug);
}

function getHealth(slug) {
  if (!healths.has(slug)) {
    healths.set(slug, { runNotified: false, expiryNotified: false });
  }
  return healths.get(slug);
}

// --- Home Assistant への通知 ---

function notifyEnabled() {
  return readOptions().notify_home_assistant !== false;
}

async function haPost(pathname, body) {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) {
    notifyProblem = 'SUPERVISOR_TOKEN が取得できていません（アドオンの再起動が必要かもしれません）';
    logError(`HA への通知をスキップしました: ${notifyProblem}`);
    return false;
  }
  try {
    const res = await fetch(`${HA_BASE}${pathname}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      notifyProblem = `HA への通知に失敗しました (${res.status}): ${detail.slice(0, 200)}`;
      logError(notifyProblem);
      return false;
    }
    notifyProblem = '';
    return true;
  } catch (e) {
    notifyProblem = `HA への通知に失敗しました: ${e.message}`;
    logError(notifyProblem);
    return false;
  }
}

// 同じ notification_id で作り直すと HA 側で上書きされ、dismiss で消せる。
// アカウントごと・種類ごとに ID を分けて、通知が積み上がらないようにする。
async function haNotify(id, title, message) {
  if (!notifyEnabled()) return false;
  log(`HA に通知します: ${title}`);
  return haPost('/api/services/persistent_notification/create', { notification_id: id, title, message });
}

async function haDismiss(id) {
  if (!notifyEnabled()) return false;
  return haPost('/api/services/persistent_notification/dismiss', { notification_id: id });
}

// 通知はアカウントごとに2種類まで。同じ ID で作り直せば増えず、
// 直ったら dismiss で消えるので、HA の通知パネルに残り続けない。
function statusNotifyId(slug) { return `claude_session_opener_${slug}`; }
function expiryNotifyId(slug) { return `claude_session_opener_expiry_${slug}`; }

// --- 接続確認 ---

// 長期トークンの発行も毎朝の実行も、この2つに繋がらないと成立しない。
// 「送ったのに何も返ってこない」ときに、ネットワーク側の問題かを切り分ける。
const REACH_TARGETS = [
  { name: 'platform.claude.com', url: 'https://platform.claude.com/' },
  { name: 'api.anthropic.com', url: 'https://api.anthropic.com/' },
];

async function checkReachability() {
  const out = [];
  for (const t of REACH_TARGETS) {
    const started = Date.now();
    try {
      const res = await fetch(t.url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
      out.push(`${t.name}: 到達できました（HTTP ${res.status} / ${Date.now() - started}ms）`);
    } catch (e) {
      const why = e.name === 'TimeoutError' ? '10秒で応答なし' : e.message;
      out.push(`${t.name}: 到達できません（${why}）`);
    }
  }
  return out.join('\n');
}

// --- 認証エラーの判定 ---

function looksLikeAuthError(text) {
  return /login expired|run \/login|not logged ?in|unauthorized|authentication_error|invalid[_ ]?(api[_ ]?key|token)|oauth[^\n]*(expired|invalid|revoked)|\b401\b/i.test(String(text || ''));
}

// トークンの期限だけを見る。実行の成否とは独立に扱う。
async function evaluateExpiry(account) {
  const h = getHealth(account.slug);
  const rec = readToken(account.slug);

  if (!rec) {
    if (h.expiryNotified) {
      h.expiryNotified = false;
      await haDismiss(expiryNotifyId(account.slug));
    }
    return;
  }

  const left = tokenDaysLeft(rec);
  if (left !== null && left <= TOKEN_WARN_DAYS) {
    if (!h.expiryNotified) {
      h.expiryNotified = true;
      const title = left <= 0
        ? 'Claude Session Opener: 長期トークンの期限が切れました'
        : 'Claude Session Opener: 長期トークンの期限が近づいています';
      const body = left <= 0
        ? `アカウント「${account.name}」の長期トークンは有効期限（1年）が切れています。`
        : `アカウント「${account.name}」の長期トークンは残り約 ${left} 日で切れます。`;
      await haNotify(
        expiryNotifyId(account.slug),
        title,
        `${body}\nサイドバーの「Claude 認証」パネルから長期トークンを発行し直してください。`,
      );
    }
  } else if (h.expiryNotified) {
    h.expiryNotified = false;
    await haDismiss(expiryNotifyId(account.slug));
  }
}

// 実行結果を受けて通知を出す/消す。失敗したらトークンの有無に関わらず必ず出す。
async function afterRun(account, outcome) {
  const h = getHealth(account.slug);

  if (outcome.failed) {
    const title = outcome.authError
      ? 'Claude Session Opener: セッションが切れました'
      : 'Claude Session Opener: 実行に失敗しました';
    const advice = outcome.authError
      ? 'サイドバーの「Claude 認証」パネルから長期トークンを発行し直してください。'
      : 'サイドバーの「Claude 認証」パネルで詳しい内容を確認してください。';
    h.runNotified = true;
    await haNotify(
      statusNotifyId(account.slug),
      title,
      `アカウント「${account.name}」\n${outcome.summary}\n${advice}`,
    );
  } else if (h.runNotified) {
    h.runNotified = false;
    log(`[${account.name}] 復帰しました。通知を消します。`);
    await haDismiss(statusNotifyId(account.slug));
  }

  await evaluateExpiry(account);
  broadcast();
}

// スケジュールの時刻が来たのにトークンが無い、も「失敗」として通知する。
async function notifyMissingToken(account) {
  const h = getHealth(account.slug);
  h.runNotified = true;
  await haNotify(
    statusNotifyId(account.slug),
    'Claude Session Opener: 実行できませんでした',
    `アカウント「${account.name}」\n長期トークンが設定されていないため、毎朝の実行ができませんでした。\n`
    + 'サイドバーの「Claude 認証」パネルから長期トークンを発行してください。',
  );
  broadcast();
}

// --- `claude -p` の実行 ---

// 終了コードだけでなく、出力の JSON も必ず見る。CLI は失敗時も JSON を返し、
// 本当の理由は result に入っているため、そこを取り出さないと
// 「終了コード 1」以上のことが何も分からない。
function summarizeRun(code, stdout, stderr, timedOut) {
  const raw = maskSecrets(`${stdout}\n${stderr}`).trim();
  if (timedOut) {
    return {
      failed: true,
      authError: false,
      summary: `応答がありません（${Math.round(RUN_TIMEOUT_MS / 1000)} 秒でタイムアウトしました）`,
      detail: raw.slice(0, 1500),
    };
  }

  let json = null;
  const trimmed = stdout.trim();
  if (trimmed.startsWith('{')) {
    try { json = JSON.parse(trimmed); } catch (e) { json = null; }
  }

  if (json && typeof json === 'object') {
    const result = typeof json.result === 'string' ? maskSecrets(json.result) : '';
    if (code === 0 && !json.is_error) {
      return {
        failed: false,
        authError: false,
        summary: `成功: 応答=${JSON.stringify(result).slice(0, 200)}`,
        detail: '',
      };
    }
    const why = result || json.subtype || json.stop_reason || '';
    const picked = {
      result,
      api_error_status: json.api_error_status,
      terminal_reason: json.terminal_reason,
      subtype: json.subtype,
      stop_reason: json.stop_reason,
      num_turns: json.num_turns,
      session_id: json.session_id,
      exit_code: code,
    };
    const lines = Object.entries(picked)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}: ${v}`);
    if (stderr.trim()) lines.push(`stderr: ${maskSecrets(stderr.trim()).slice(0, 500)}`);
    return {
      failed: true,
      authError: looksLikeAuthError(`${result} ${json.subtype || ''} ${json.api_error_status || ''} ${stderr}`),
      summary: why ? `失敗: ${why.slice(0, 300)}` : `失敗しました（終了コード ${code}）`,
      detail: lines.join('\n'),
    };
  }

  const firstLine = raw.split('\n').find((l) => l.trim()) || '';
  return {
    failed: true,
    authError: looksLikeAuthError(raw),
    summary: code === 0
      ? `応答を解析できませんでした: ${firstLine.slice(0, 200)}`
      : `コマンドが失敗しました（終了コード ${code}）: ${firstLine.slice(0, 200)}`,
    detail: raw.slice(0, 1500),
  };
}

// プロセスグループごと止める。detached で起動したものだけに使う。
function killTree(proc) {
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch (e) {
    try { proc.kill('SIGKILL'); } catch (e2) { /* すでに終わっていれば何もしない */ }
  }
}

// source: schedule（毎朝）/ manual（今すぐ実行）/ verify（トークン保存直後の動作確認）
function runPing(account, source) {
  const r = getRun(account.slug);
  if (r.running) return Promise.resolve(null);
  r.running = true;
  r.source = source;
  broadcast();

  return new Promise((resolve) => {
    let proc;
    try {
      // detached: true で独立したプロセスグループにする。タイムアウトしたときに
      // 子プロセスごと（claude が更に何か起動していても）まとめて止めるため。
      proc = spawn(
        'claude',
        ['-p', 'ok', '--model', 'haiku', '--output-format', 'json', '--no-session-persistence'],
        { stdio: ['ignore', 'pipe', 'pipe'], env: claudeEnv(account.slug), detached: true },
      );
    } catch (e) {
      const outcome = { failed: true, authError: false, summary: `claude を起動できませんでした: ${e.message}`, detail: '' };
      finishRun(account, source, outcome);
      resolve(outcome);
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finishRun(account, source, outcome);
      resolve(outcome);
    };

    // 応答が返らないときは、出力の口が閉じるのを待たずにここで打ち切る。
    // 孫プロセスが標準出力を握っていると close イベントが永久に来ないため。
    timer = setTimeout(() => {
      killTree(proc);
      settle(summarizeRun(null, stdout, stderr, true));
    }, RUN_TIMEOUT_MS);

    proc.stdout.on('data', (c) => { stdout += c; });
    proc.stderr.on('data', (c) => { stderr += c; });
    proc.on('error', (e) => {
      settle({ failed: true, authError: false, summary: `claude を起動できませんでした: ${e.message}`, detail: '' });
    });
    proc.on('close', (code) => {
      settle(summarizeRun(code, stdout, stderr, false));
    });
  });
}

function finishRun(account, source, outcome) {
  const r = getRun(account.slug);
  if (!r.running) return;
  r.running = false;
  r.at = ts();
  r.ok = !outcome.failed;
  r.source = source;
  r.summary = outcome.summary;
  r.detail = outcome.detail || '';

  const label = { schedule: 'セッションオープナー実行結果', manual: '手動実行の結果', verify: 'トークンの動作確認' }[source] || '実行結果';
  if (outcome.failed) logError(`[${account.name}] ${label}: ${outcome.summary}`);
  else log(`[${account.name}] ${label}: ${outcome.summary}`);
  if (outcome.failed && outcome.detail) logError(`[${account.name}] 詳細: ${outcome.detail.replace(/\n/g, ' ').slice(0, 800)}`);

  afterRun(account, outcome).catch((e) => logError(`[${account.name}] 通知処理に失敗: ${e.message}`));
  broadcast();
}

function schedulerTick() {
  const accounts = loadAccounts();
  const now = new Date();
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const minuteKey = `${now.toISOString().slice(0, 10)} ${hh}:${mm}`;
  const currentTime = `${hh}:${mm}`;

  for (const account of accounts) {
    if (account.scheduleTime !== currentTime) continue;
    if (lastFiredMinute.get(account.slug) === minuteKey) continue;
    lastFiredMinute.set(account.slug, minuteKey);
    log(`[${account.name}] セッションオープナーを実行します...`);

    if (!readToken(account.slug)) {
      const r = getRun(account.slug);
      r.running = false;
      r.at = ts();
      r.ok = false;
      r.source = 'schedule';
      r.summary = '長期トークンが未設定のため実行できませんでした';
      r.detail = '';
      logError(`[${account.name}] ${r.summary}`);
      notifyMissingToken(account).catch((e) => logError(`[${account.name}] 通知処理に失敗: ${e.message}`));
      broadcast();
      continue;
    }

    runPing(account, 'schedule');
  }
}

// --- 長期トークンの発行フロー ---

// CLI のエラー行（"OAuth error: Request failed with status code 400"）は
// Ink が桁移動で描き直すので、そのまま取り出すと文字が欠けたり繋がったりする。
// 文字列をそのまま画面へ出さず、HTTP のステータスから意味を組み立てる。
function describeOAuthError(flat) {
  const status = (flat.match(/statuscode(\d{3})/) || [])[1] || '';
  if (status === '400') {
    return 'コードが正しくないか、すでに使われた／期限が切れています（HTTP 400）。';
  }
  if (status === '401' || status === '403') {
    return `このアカウントでは認証できませんでした（HTTP ${status}）。Claude Pro/Max のアカウントか確認してください。`;
  }
  if (/^5\d\d$/.test(status)) {
    return `Claude 側でエラーが起きています（HTTP ${status}）。少し待ってからやり直してください。`;
  }
  if (/networkerror|enotfound|econnrefused|etimedout|timeout/.test(flat)) {
    return 'Claude に接続できませんでした。ネットワークを確認してください。';
  }
  return status ? `認証に失敗しました（HTTP ${status}）。` : '認証に失敗しました。';
}


// 制御文字で止める。\S+ だと OSC ハイパーリンクのパラメータに続く
// 表示テキストまで飲み込んでしまう。
function extractUrl(text) {
  const matches = String(text || '').match(/https:\/\/[^\s\x00-\x20\x7f]+/g);
  return matches ? matches[matches.length - 1] : null;
}

function armInactivity(slug) {
  const f = getFlow(slug);
  const runId = f.runId;
  if (f.timer) clearTimeout(f.timer);
  f.timer = setTimeout(() => {
    if (f.runId !== runId) return;
    cancelFlow(slug, 'タイムアウトしました（15分）。もう一度やり直してください。');
  }, INACTIVITY_TIMEOUT_MS);
}

function clearSubmitTimer(slug) {
  const f = getFlow(slug);
  if (f.submitTimer) clearTimeout(f.submitTimer);
  f.submitTimer = null;
}

// 1年有効な長期トークンを `claude setup-token` で発行する。
// setup-token は Ink（対話 UI）で動くため、端末が無いと何も出力せず固まる。
// `script` で疑似端末を用意して動かす。あわせて `stty cols` で端末幅を広く取り、
// URL やトークンが折り返されて途中で切れないようにする
// （実測: 既定の80桁だと URL が5行に折り返される）。
function startFlow(slug) {
  const f = getFlow(slug);
  if (f.proc) return { ok: false, error: 'すでに発行中です。' };

  // 中止直後に再発行すると、殺した側の close イベントが後から届く。
  // 世代を進めておき、古い世代のイベントは捨てる（新しいフローを潰さないため）。
  f.runId += 1;
  const runId = f.runId;
  f.buffer = '';
  f.detectFrom = 0;
  f.url = '';
  f.phase = 'starting';
  f.error = '';
  f.urlRotated = false;
  f.retrySent = false;
  f.tokenSaved = false;
  f.screen = '';
  f.errorScreen = '';
  clearNotice(slug);
  broadcast();

  // 既存の長期トークンは渡さない（CLI がそちらを使ってフローが始まらないのを避ける）。
  let proc;
  try {
    proc = spawn(
      'script',
      ['-qec', `stty cols ${PTY_COLS} rows ${PTY_ROWS}; claude setup-token`, '/dev/null'],
      { stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv(slug, { withToken: false }) },
    );
  } catch (e) {
    f.phase = 'idle';
    setNotice(slug, 'error', `発行を開始できませんでした: ${e.message}`);
    broadcast();
    return { ok: false, error: e.message };
  }

  f.proc = proc;
  armInactivity(slug);

  const onData = (chunk) => {
    if (f.runId !== runId) return;
    handleFlowOutput(slug, chunk.toString());
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('error', (e) => {
    if (f.runId !== runId) return;
    f.proc = null;
    f.phase = 'idle';
    setNotice(slug, 'error', `発行を開始できませんでした: ${e.message}`);
    broadcast();
  });
  proc.on('close', (code) => {
    if (f.runId !== runId) return;
    finishFlow(slug, code);
  });
  return { ok: true };
}

// 疑似端末の出力から今の状態を読み取る。
// CLI 側の画面は state: waiting_for_login / about_to_retry / success / error で、
// 文言はそれぞれ "Paste code here if prompted >" / "Retrying…" /
// "Long-lived authentication token created successfully!" / "OAuth error: <理由>" になる
// （CLI 2.1.x で実際に確認。"Invalid code" という文言はもう存在しない）。
function handleFlowOutput(slug, chunk) {
  const f = getFlow(slug);
  if (!f.proc) return;
  const grown = f.buffer + chunk;
  if (grown.length > FLOW_BUFFER_MAX) {
    const cut = grown.length - FLOW_BUFFER_MAX;
    f.buffer = grown.slice(cut);
    f.detectFrom = Math.max(0, f.detectFrom - cut);
  } else {
    f.buffer = grown;
  }
  // 画面の組み立ては最初から通す（途中から始めると桁移動の起点がずれて
  // 文字が欠ける）。文言の判定だけ、前回の送信より後ろに限る。
  const view = stripAnsi(f.buffer);
  const flat = flatten(f.buffer.slice(f.detectFrom));
  f.screen = screenText(f.buffer);

  // 1) トークンが画面に出た = 成功。CLI の終了を待たずにその場で保存する。
  //    待ってから拾う作りだと、CLI が終わらなかったときに取りこぼす。
  if (TOKEN_RE.test(view)) {
    if (!f.tokenSaved) {
      // 生のバッファを渡す。エスケープを落とした後のテキストを渡すと
      // 画面の組み立て直しができず、隣の行の文字が繋がったまま保存される。
      const token = extractToken(f.buffer);
      if (token) {
        f.tokenSaved = true;
        saveToken(slug, token);
        log(`[${accountLabel(slug)}] 長期トークンを保存しました（有効期間: 約1年 / ${token.length} 文字）`);
        setNotice(slug, 'success', '長期トークンを保存しました（有効期間: 約1年）。動作確認のため1回だけ実行します。');
        // 普通は CLI が自分で終わる。終わらないときのために少しだけ待って止める。
        const runId = f.runId;
        setTimeout(() => { if (f.runId === runId && f.proc) f.proc.kill(); }, 5000);
      }
    }
    f.phase = 'finishing';
    f.error = '';
    clearSubmitTimer(slug);
    armInactivity(slug);
    broadcast();
    return;
  }

  // 2) 認証 URL。エラーのあとは CLI が state を作り直して別の URL を出すので、
  //    変わったら「取り直しが必要」と分かるようにする。
  const url = extractUrl(view);
  if (url && url !== f.url) {
    if (f.url) f.urlRotated = true;
    f.url = url;
    f.retrySent = false;
    if (f.phase === 'starting' || f.phase === 'retrying') f.phase = 'waiting';
  }

  // 3) OAuth エラー。CLI は "Press Enter to retry." で止まるので、
  //    こちらから Enter を送って入力待ちまで戻す。戻さないと次の送信が捨てられる。
  if (/oautherror/.test(flat)) {
    // CLI が出した原文も添える。こちらの言い換えが外れていても、
    // 何が起きたかが画面で分かるようにするため。
    const cliLine = (/OAuth\s*error\s*:\s*([^\n]+)/i.exec(f.screen) || [])[1];
    f.error = describeOAuthError(flat) + (cliLine ? `\nCLI の表示: OAuth error: ${cliLine.trim()}` : '');
    // エラーが出た瞬間の画面を残す（このあとバッファを捨てても消えないように）。
    f.errorScreen = f.screen;
    clearSubmitTimer(slug);
    if (/pressentertoretry/.test(flat)) {
      if (!f.retrySent) {
        f.retrySent = true;
        f.phase = 'retrying';
        logError(`[${accountLabel(slug)}] 長期トークンの発行でエラー:\n${f.errorScreen}`);
        // 同じエラーを二度拾わないよう、判定の起点だけ今の位置へ進める。
        f.detectFrom = f.buffer.length;
        try { f.proc.stdin.write('\r'); } catch (e) { /* 終了済みなら close 側で扱う */ }
      }
    } else {
      f.phase = 'waiting';
    }
    armInactivity(slug);
    broadcast();
    return;
  }

  // 4) 入力待ち
  if (/pastecodehereifprompted/.test(flat) && f.url && f.phase !== 'submitting' && f.phase !== 'finishing') {
    f.phase = 'waiting';
  }

  armInactivity(slug);
  broadcast();
}

// 貼り付けたものをそのまま通す。前後の空白・改行・引用符は落とし、
// コールバック URL ごと貼られた場合は code と state を組み立てる。
function normalizeCode(raw) {
  let v = String(raw == null ? '' : raw).trim().replace(/\s+/g, '').replace(/^["'`]+|["'`]+$/g, '');
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      const c = u.searchParams.get('code');
      const s = u.searchParams.get('state');
      if (c && c !== 'true') return s ? `${c}#${s}` : c;
    } catch (e) { /* URL として読めなければそのまま扱う */ }
  }
  return v;
}

function submitCode(slug, rawCode) {
  const f = getFlow(slug);
  if (!f.proc) return { ok: false, error: '発行フローが動いていません。もう一度「長期トークンを発行」から始めてください。' };
  if (f.phase === 'submitting') return { ok: false, error: '確認中です。少し待ってください。' };
  if (f.phase !== 'waiting') return { ok: false, error: 'いまは送信できません。' };

  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, error: 'コードが空です。' };

  const runId = f.runId;
  f.detectFrom = f.buffer.length;
  f.error = '';
  f.errorScreen = '';
  f.urlRotated = false;
  f.phase = 'submitting';
  try {
    // 疑似端末では Enter は CR。LF だと確定されない。
    // さらに、コードと CR を1回の write でまとめて送ってはいけない。
    // CLI の入力欄は、まとめて届いた長い chunk を「貼り付け」として扱い、
    // 同じ chunk に入っている改行を確定操作として扱わないため、
    // 送信しても何も起きない（実測: 109文字を1回で送ると無反応、
    // そのあと CR だけを単独で送ると即座に確定した）。
    // 実際の認証コードは100文字を超えるので必ずこれを踏む。
    f.proc.stdin.write(code);
    setTimeout(() => {
      if (f.runId !== runId || !f.proc) return;
      try { f.proc.stdin.write('\r'); } catch (e2) { /* 終了済みなら close 側で扱う */ }
    }, SUBMIT_ENTER_DELAY_MS);
  } catch (e) {
    f.phase = 'waiting';
    f.error = `コードを送れませんでした: ${e.message}`;
    broadcast();
    return { ok: false, error: f.error };
  }

  clearSubmitTimer(slug);
  f.submitTimer = setTimeout(() => {
    if (f.runId !== runId || f.phase !== 'submitting') return;
    f.phase = 'waiting';
    f.error = `コードを送ってから ${Math.round(SUBMIT_TIMEOUT_MS / 1000)} 秒たっても CLI から応答がありません。`;
    // 何が起きているか分からないまま終わらせない。画面の中身をログに出し、
    // ネットワーク側かどうかも調べて画面に出す。
    f.errorScreen = screenText(f.buffer);
    logError(`[${accountLabel(slug)}] コード送信後に応答なし。CLI の画面:\n${f.errorScreen}`);
    broadcast();
    checkReachability().then((result) => {
      logError(`[${accountLabel(slug)}] 接続確認:\n${result}`);
      if (f.phase === 'waiting') {
        f.error = `${f.error}\n${result}`;
        broadcast();
      }
    }).catch(() => {});
  }, SUBMIT_TIMEOUT_MS);

  armInactivity(slug);
  broadcast();
  return { ok: true };
}

function cancelFlow(slug, message) {
  const f = getFlow(slug);
  const running = Boolean(f.proc);
  // これ以降、このプロセスのイベントは受け取らない。
  f.runId += 1;
  if (f.proc) f.proc.kill();
  if (f.timer) clearTimeout(f.timer);
  clearSubmitTimer(slug);
  f.proc = null;
  f.timer = null;
  f.buffer = '';
  f.detectFrom = 0;
  f.url = '';
  f.phase = 'idle';
  f.error = '';
  f.urlRotated = false;
  f.retrySent = false;
  f.tokenSaved = false;
  f.screen = '';
  f.errorScreen = '';
  if (message) setNotice(slug, 'info', message);
  else if (running) setNotice(slug, 'info', '発行を中止しました。');
  broadcast();
  return { ok: true };
}

function finishFlow(slug, code) {
  const f = getFlow(slug);
  if (f.timer) clearTimeout(f.timer);
  clearSubmitTimer(slug);
  f.timer = null;
  f.proc = null;

  // 画面に出た時点で保存できていなければ、最後にもう一度だけ出力から拾う。
  // バッファは即座に捨てる（トークンがメモリやログに残らないように）。
  const token = f.tokenSaved ? null : extractToken(f.buffer);
  const lastError = f.error;
  const saved = f.tokenSaved || Boolean(token);
  f.buffer = '';
  f.detectFrom = 0;
  f.url = '';
  f.phase = 'idle';
  f.error = '';
  f.urlRotated = false;
  f.retrySent = false;
  f.tokenSaved = false;

  if (token) {
    saveToken(slug, token);
    log(`[${accountLabel(slug)}] 長期トークンを保存しました（有効期間: 約1年 / ${token.length} 文字）`);
    setNotice(slug, 'success', '長期トークンを保存しました（有効期間: 約1年）。動作確認のため1回だけ実行します。');
  }

  if (saved) {
    broadcast();
    const account = findAccount(slug);
    if (account) runPing(account, 'verify');
    return;
  }

  const why = lastError ? `（${lastError}）` : '';
  setNotice(slug, 'error', code === 0
    ? `トークンを取り出せませんでした${why}。パソコンで claude setup-token を実行し、表示されたトークンを下の欄に貼り付けてください。`
    : `発行が終了しました（終了コード ${code}）${why}。もう一度お試しください。`);
  broadcast();
}

// パソコンで `claude setup-token` を実行した場合の貼り付け経路。
// UI 内での発行がうまくいかないときの逃げ道として用意する。
function saveTokenManually(slug, token) {
  const value = String(token || '').trim();
  if (!looksLikeToken(value)) {
    setNotice(slug, 'error', 'トークンの形式が違うようです（sk-ant- で始まる文字列を貼り付けてください）。');
    broadcast();
    return { ok: false, error: 'トークンの形式が違います。' };
  }
  saveToken(slug, value);
  log(`[${accountLabel(slug)}] 貼り付けられた長期トークンを保存しました（${value.length} 文字）`);
  setNotice(slug, 'success', '長期トークンを保存しました（有効期間: 約1年）。動作確認のため1回だけ実行します。');
  broadcast();
  const account = findAccount(slug);
  if (account) runPing(account, 'verify');
  return { ok: true };
}

function removeToken(slug) {
  deleteToken(slug);
  log(`[${accountLabel(slug)}] 長期トークンを削除しました`);
  setNotice(slug, 'info', '長期トークンを削除しました。');
  const account = findAccount(slug);
  // 期限の通知だけ消す。実行失敗の通知は「実行が成功するまで」消さない。
  if (account) evaluateExpiry(account).catch((e) => logError(`[${account.name}] 通知処理に失敗: ${e.message}`));
  broadcast();
  return { ok: true };
}

async function sendTestNotification(slug) {
  if (!notifyEnabled()) {
    return { ok: false, error: '設定タブの「Home Assistant へ通知する」が無効です。' };
  }
  const name = accountLabel(slug);
  const ok = await haPost('/api/services/persistent_notification/create', {
    notification_id: `claude_session_opener_test_${slug}`,
    title: 'Claude Session Opener: テスト通知',
    message: `アカウント「${name}」からのテスト通知です。\nこれが見えていれば、実行が失敗したときの通知も届きます。`,
  });
  if (ok) log(`[${name}] テスト通知を送りました`);
  broadcast();
  return ok ? { ok: true } : { ok: false, error: notifyProblem || '通知の送信に失敗しました。' };
}

// --- 画面状態 ---

function computeViewState() {
  const accounts = loadAccounts();
  return {
    notifyEnabled: notifyEnabled(),
    notifyProblem,
    accounts: accounts.map((account) => {
      const f = getFlow(account.slug);
      const r = getRun(account.slug);
      const rec = readToken(account.slug);
      const notice = notices.get(account.slug) || null;
      // 「発行フローが動いている」は phase で判断する。プロセスを spawn する前の
      // 一瞬（phase=starting）を idle と答えてしまうと、画面のボタンがその隙間だけ
      // 押せる状態に戻ってしまう。
      const flowActive = f.phase !== 'idle';
      return {
        slug: account.slug,
        name: account.name,
        scheduleTime: account.scheduleTime,
        token: {
          present: Boolean(rec),
          daysLeft: rec ? tokenDaysLeft(rec) : null,
          // 中身は出さない。途中で欠けたトークンを保存していないかを
          // アカウント間で見比べるための文字数だけ。
          length: rec ? rec.token.length : 0,
        },
        busy: flowActive || r.running,
        flow: {
          active: flowActive,
          phase: f.phase,
          url: f.url || '',
          urlRotated: f.urlRotated,
          error: f.error || '',
          screen: (f.error && f.errorScreen) || f.screen || '',
        },
        run: {
          running: r.running,
          at: r.at,
          ok: r.ok,
          source: r.source,
          summary: r.summary,
          detail: r.detail,
        },
        notice,
      };
    }),
  };
}

function broadcast() {
  const payload = `data: ${JSON.stringify(computeViewState())}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch (e) { clients.delete(res); }
  }
}

// --- HTTP サーバー ---

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(payload);
}

// index.html には Ingress のベースパスを埋め込む。Ingress の URL は
// トークン込みで実行時にしか分からないため、ビルド時には決められない。
function serveIndex(req, res) {
  const file = path.join(PUBLIC_DIR, 'index.html');
  fs.readFile(file, 'utf8', (err, html) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('フロントエンドのビルド結果が見つかりません');
      return;
    }
    const ingressPath = String(req.headers['x-ingress-path'] || '').replace(/\/$/, '');
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
    res.end(html.replace(/\{\{INGRESS_PATH\}\}/g, ingressPath));
  });
}

function serveStatic(reqPath, res) {
  const rel = reqPath.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('forbidden');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 64 * 1024) { body = body.slice(0, 64 * 1024); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

async function handlePost(reqPath, body) {
  const account = findAccount(body.account);
  if (!account) return { ok: false, error: '知らないアカウントです。設定タブを確認してください。' };

  switch (reqPath) {
    case '/api/notify/test':
      return sendTestNotification(account.slug);
    case '/api/diagnose': {
      const result = await checkReachability();
      log(`[${account.name}] 接続確認:\n${result}`);
      setNotice(account.slug, /到達できません/.test(result) ? 'error' : 'info', result);
      broadcast();
      return { ok: true };
    }
    case '/api/token/start':
      return startFlow(account.slug);
    case '/api/token/submit':
      return submitCode(account.slug, body.code);
    case '/api/token/cancel':
      return cancelFlow(account.slug);
    case '/api/token/save':
      return saveTokenManually(account.slug, body.token);
    case '/api/token/delete':
      return removeToken(account.slug);
    case '/api/run': {
      const r = getRun(account.slug);
      if (r.running) return { ok: false, error: 'すでに実行中です。' };
      if (!readToken(account.slug)) return { ok: false, error: '長期トークンが未設定です。先に発行してください。' };
      runPing(account, 'manual');
      return { ok: true };
    }
    default:
      return null;
  }
}

const server = http.createServer((req, res) => {
  const reqPath = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';

  if (req.method === 'GET' && (reqPath === '/' || reqPath === '/index.html')) {
    serveIndex(req, res);
    return;
  }

  if (req.method === 'GET' && reqPath === '/api/state') {
    sendJson(res, 200, computeViewState());
    return;
  }

  if (req.method === 'GET' && reqPath === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    res.write(`data: ${JSON.stringify(computeViewState())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (req.method === 'POST' && reqPath.startsWith('/api/')) {
    readBody(req).then(async (body) => {
      let result;
      try {
        result = await handlePost(reqPath, body);
      } catch (e) {
        logError(`API エラー (${reqPath}): ${e.message}`);
        sendJson(res, 500, { ok: false, error: e.message });
        return;
      }
      if (result === null) {
        sendJson(res, 404, { ok: false, error: 'not found' });
        return;
      }
      sendJson(res, result.ok ? 200 : 400, result);
    });
    return;
  }

  if (req.method === 'GET') {
    serveStatic(reqPath, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

setInterval(() => {
  for (const res of clients) {
    try { res.write(': heartbeat\n\n'); } catch (e) { clients.delete(res); }
  }
}, HEARTBEAT_MS);

setInterval(schedulerTick, SCHEDULER_TICK_MS);

server.listen(PORT, '0.0.0.0', () => {
  log(`Claude Session Opener listening on :${PORT}`);
  const accounts = loadAccounts();
  if (accounts.length === 0) {
    log('警告: accounts が設定されていません。アドオンの設定タブで追加してください。');
  } else {
    for (const a of accounts) {
      const rec = readToken(a.slug);
      const left = rec ? tokenDaysLeft(rec) : null;
      let state = '長期トークン未設定';
      if (rec) state = left === null || left > 0 ? `長期トークンあり（残り約 ${left} 日）` : '長期トークンあり（期限切れ）';
      log(`アカウント "${a.name}": 毎日 ${a.scheduleTime} (UTC) に実行 / ${state}`);
    }
  }
  if (!notifyEnabled()) log('Home Assistant への通知は無効です。');
  else if (!process.env.SUPERVISOR_TOKEN) logError('SUPERVISOR_TOKEN がありません。HA への通知ができません。');
  for (const a of accounts) {
    evaluateExpiry(a).catch((e) => logError(`[${a.name}] 通知処理に失敗: ${e.message}`));
  }
});
