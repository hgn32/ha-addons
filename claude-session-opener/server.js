'use strict';

// Claude Session Opener のメインプロセス。以下をまとめて担当する。
//   1. アカウントごとの schedule_time になったら `claude -p "ok"` を実行するスケジューラ
//   2. Ingress 経由のログイン用 Web UI（Server-Sent Events でリアルタイム更新）
//   3. 認証状態の定期チェックと、切れたときの Home Assistant への通知
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
// 認証は2通り。
//   - `claude auth login`（サブスクリプションログイン）。有効期限が短く、
//     切れると毎回ログインし直す必要がある
//   - `claude setup-token` が発行する**1年有効**の長期トークン。
//     $CLAUDE_CODE_OAUTH_TOKEN として渡す。毎朝の実行しかしないこのアドオンでは
//     こちらのほうが向いているため、UI ではこちらを推奨として出す

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const PORT = 8099;
const OPTIONS_PATH = '/data/options.json';
// 認証情報は /data 配下に保存する。/config（addon_config マップ）は
// 他のアドオン（File Editor, Samba 等）からも見える可能性がある共有領域なので、
// OAuth トークンの置き場所には向かない。/data はこのアドオン専用で他から
// アクセスされず、このアドオンを選んでバックアップすれば含まれる。
const CRED_ROOT = '/data/claude-credentials';
const TOKEN_FILE = 'oauth-token.json';
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
const HEARTBEAT_MS = 25 * 1000;
const SCHEDULER_TICK_MS = 20 * 1000;
// 認証切れの検知間隔。切れてから最大この時間で HA に通知が飛ぶ。
const HEALTH_CHECK_MS = 30 * 60 * 1000;
// `claude setup-token` が発行するトークンの有効期間（公式ドキュメントで1年）。
// CLI は期限そのものを教えてくれないので、発行日時から自前で数える。
const TOKEN_LIFETIME_DAYS = 365;
// 残りこの日数を切ったら「そろそろ再発行を」と HA に通知する。
const TOKEN_WARN_DAYS = 14;
// setup-token 用の疑似端末のサイズ。トークン（100文字強）と認証 URL が
// 1行に収まるだけの幅を取る。
const PTY_COLS = 400;
const PTY_ROWS = 60;

// HA Core API は Supervisor のプロキシ経由で叩く。SUPERVISOR_TOKEN は
// Supervisor がコンテナへ自動注入する。config.json の homeassistant_api: true
// が無いと 401 になる。
const HA_BASE = process.env.SUPERVISOR_API || 'http://supervisor/core';

// slug -> { proc, kind, url, status, message, timer }  (ログイン／トークン発行の状態)
const loginStates = new Map();
// slug -> "YYYY-MM-DD HH:MM" (直近に発火した分。同じ分での二重発火を防ぐ)
const lastFiredMinute = new Map();
// slug -> 認証の健全性と、HA へ出した通知の状態
const healthStates = new Map();

const clients = new Set();

// console.log は HA の「ログ」タブにそのまま流れるが、
// run.sh 側の bashio::log と違って時刻が付かないため、自前で付与する。
function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}
function log(msg) { console.log(`[${ts()}] ${msg}`); }
function logError(msg) { console.error(`[${ts()}] ${msg}`); }

// CSI（色や桁移動）と OSC（ハイパーリンク等。BEL か ST で終わる）を落とす。
// `claude setup-token` は疑似端末上で動く UI なので、出力にこれらが混ざる。
function stripAnsi(s) {
  return String(s == null ? '' : s)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][@-~]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '');
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
  return /^sk-ant-[A-Za-z0-9]+-[A-Za-z0-9_-]{20,}$/.test(String(s || '').trim());
}

const TOKEN_RE = /sk-ant-[A-Za-z0-9]+-[A-Za-z0-9_-]{20,}/;

function extractToken(text) {
  const clean = stripAnsi(text);
  const direct = clean.match(TOKEN_RE);
  if (direct) return direct[0];
  // 端末幅を広く取っているので通常は折り返されないが、念のため改行を畳んだ版でも探す。
  const m = clean.replace(/[\r\n]+/g, '').match(TOKEN_RE);
  return m ? m[0] : null;
}

// claude CLI を起動するときの環境変数。長期トークンがあればそれを使う
// （認証の優先順位で $CLAUDE_CODE_OAUTH_TOKEN はログイン認証情報より上）。
function claudeEnv(slug, { withToken = true } = {}) {
  const dir = credDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  const env = { ...process.env, CLAUDE_CONFIG_DIR: dir };
  const rec = withToken ? readToken(slug) : null;
  if (rec) env.CLAUDE_CODE_OAUTH_TOKEN = rec.token;
  else delete env.CLAUDE_CODE_OAUTH_TOKEN;
  return env;
}

function getLoginState(slug) {
  if (!loginStates.has(slug)) {
    loginStates.set(slug, { proc: null, kind: null, buffer: '', url: null, status: 'idle', message: '', timer: null });
  }
  return loginStates.get(slug);
}

function getHealth(slug) {
  if (!healthStates.has(slug)) {
    healthStates.set(slug, {
      healthy: null,          // null = 未判定
      reason: '',
      lastPingAuthError: false,
      expiringNotified: false,
      runFailNotified: false,
    });
  }
  return healthStates.get(slug);
}

function getAuthStatus(slug) {
  try {
    const out = execFileSync('claude', ['auth', 'status', '--json'], {
      timeout: 10000,
      env: claudeEnv(slug, { withToken: false }),
    }).toString();
    return JSON.parse(out);
  } catch (e) {
    return null;
  }
}

// --- Home Assistant への通知 ---

function notifyEnabled() {
  return readOptions().notify_home_assistant !== false;
}

async function haPost(pathname, body) {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) {
    logError('SUPERVISOR_TOKEN が無いため HA への通知をスキップしました');
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
      logError(`HA への通知に失敗しました (${res.status}): ${detail.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (e) {
    logError(`HA への通知に失敗しました: ${e.message}`);
    return false;
  }
}

// 同じ notification_id で作り直すと HA 側で上書きされ、dismiss で消せる。
// アカウントごと・種類ごとに ID を分けて、通知が積み上がらないようにする。
async function haNotify(id, title, message) {
  if (!notifyEnabled()) return;
  log(`HA に通知します: ${title}`);
  await haPost('/api/services/persistent_notification/create', { notification_id: id, title, message });
}

async function haDismiss(id) {
  if (!notifyEnabled()) return;
  await haPost('/api/services/persistent_notification/dismiss', { notification_id: id });
}

// 通知パネルに出すだけでなくイベントも投げる。スマホへのプッシュなど、
// ユーザーがオートメーションで好きな通知先に流せるようにするため。
async function haEvent(type, data) {
  if (!notifyEnabled()) return;
  await haPost(`/api/events/${type}`, data);
}

function authNotifyId(slug) { return `claude_session_opener_auth_${slug}`; }
function expiryNotifyId(slug) { return `claude_session_opener_expiry_${slug}`; }
function runNotifyId(slug) { return `claude_session_opener_run_${slug}`; }

// --- 認証の健全性チェック ---

function looksLikeAuthError(text) {
  return /login expired|run \/login|not logged ?in|unauthorized|authentication_error|invalid[_ ]?(api[_ ]?key|token)|oauth[^\n]*(expired|invalid|revoked)|\b401\b/i.test(String(text || ''));
}

async function evaluateHealth(account) {
  const h = getHealth(account.slug);
  const rec = readToken(account.slug);
  let healthy;
  let reason = '';

  if (rec) {
    const left = tokenDaysLeft(rec);
    if (left !== null && left <= 0) {
      healthy = false;
      reason = '長期トークンの有効期限（1年）が切れました。';
    } else if (h.lastPingAuthError) {
      healthy = false;
      reason = '長期トークンで認証できませんでした（失効・取り消しの可能性があります）。';
    } else {
      healthy = true;
    }

    // 期限が近いときの予告通知。復帰（再発行）したら消す。
    if (healthy && left !== null && left <= TOKEN_WARN_DAYS) {
      if (!h.expiringNotified) {
        h.expiringNotified = true;
        await haNotify(
          expiryNotifyId(account.slug),
          'Claude Session Opener: トークンの期限が近づいています',
          `アカウント「${account.name}」の長期トークンは残り約 ${left} 日で切れます。\n`
          + 'サイドバーの「Claude Login」パネルから「長期トークンを再発行」してください。',
        );
        await haEvent('claude_session_opener_token_expiring', {
          account: account.name, slug: account.slug, days_left: left,
        });
      }
    } else if (h.expiringNotified) {
      h.expiringNotified = false;
      await haDismiss(expiryNotifyId(account.slug));
    }
  } else {
    const auth = getAuthStatus(account.slug);
    if (!auth || !auth.loggedIn) {
      healthy = false;
      reason = 'ログインの有効期限が切れたか、ログアウトされています。';
    } else if (h.lastPingAuthError) {
      healthy = false;
      reason = 'ログイン情報で認証できませんでした（有効期限切れの可能性があります）。';
    } else {
      healthy = true;
    }
  }

  h.reason = healthy ? '' : reason;
  if (h.healthy === healthy) return;

  const first = h.healthy === null;
  h.healthy = healthy;

  if (!healthy) {
    logError(`[${account.name}] 認証が無効です: ${reason}`);
    await haNotify(
      authNotifyId(account.slug),
      'Claude Session Opener: セッションが切れました',
      `アカウント「${account.name}」の認証が切れました。\n${reason}\n`
      + 'サイドバーの「Claude Login」パネルから、1年有効な長期トークンを発行し直すと'
      + 'この状態になりにくくなります。',
    );
    await haEvent('claude_session_opener_auth_lost', {
      account: account.name, slug: account.slug, reason,
    });
  } else if (!first) {
    log(`[${account.name}] 認証が回復しました。`);
    await haDismiss(authNotifyId(account.slug));
    await haEvent('claude_session_opener_auth_restored', {
      account: account.name, slug: account.slug,
    });
  }
  broadcast();
}

function healthTick() {
  for (const account of loadAccounts()) {
    evaluateHealth(account).catch((e) => logError(`[${account.name}] 認証チェックに失敗: ${e.message}`));
  }
}

// --- スケジューラ: ping ---

function runPing(account) {
  const proc = spawn(
    'claude',
    ['-p', 'ok', '--model', 'haiku', '--output-format', 'json', '--no-session-persistence'],
    { stdio: ['ignore', 'pipe', 'pipe'], env: claudeEnv(account.slug) },
  );

  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (c) => { stdout += c; });
  proc.stderr.on('data', (c) => { stderr += c; });

  proc.on('close', (code) => {
    if (stderr) logError(`[${account.name}] stderr: ${stderr}`);

    let summary;
    let failed = false;
    if (code !== 0) {
      failed = true;
      summary = `コマンドが失敗しました（終了コード: ${code}）: ${(stdout + stderr).slice(0, 300)}`;
    } else {
      try {
        const j = JSON.parse(stdout);
        if (j.is_error) {
          failed = true;
          summary = `エラー: ${j.result || j.subtype || 'unknown'}`;
        } else {
          summary = `成功: 応答=${JSON.stringify(j.result)} session_id=${j.session_id}`;
        }
      } catch (e) {
        failed = true;
        summary = `応答の解析に失敗しました: ${stdout.slice(0, 300)}`;
      }
    }
    log(`[${account.name}] セッションオープナー実行結果: ${summary}`);

    const h = getHealth(account.slug);
    h.lastPingAuthError = failed && looksLikeAuthError(stdout + stderr);

    (async () => {
      if (failed) {
        if (!h.runFailNotified) {
          h.runFailNotified = true;
          await haNotify(
            runNotifyId(account.slug),
            'Claude Session Opener: 実行に失敗しました',
            `アカウント「${account.name}」の毎朝の実行が失敗しました。\n${summary}`,
          );
          await haEvent('claude_session_opener_run_failed', {
            account: account.name, slug: account.slug, detail: summary,
          });
        }
      } else if (h.runFailNotified) {
        h.runFailNotified = false;
        await haDismiss(runNotifyId(account.slug));
      }
      await evaluateHealth(account);
    })().catch((e) => logError(`[${account.name}] 通知処理に失敗: ${e.message}`));
  });
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
    runPing(account);
  }
}

// --- ログイン／トークン発行フロー ---

// 制御文字（OSC の終端 BEL を含む）で止める。\S+ だと OSC ハイパーリンクの
// パラメータに続く表示テキストまで飲み込んでしまう。
function extractUrl(text) {
  const matches = String(text || '').match(/https:\/\/[^\s\x00-\x20\x7f]+/g);
  return matches ? matches[matches.length - 1] : null;
}

function resetTimer(slug) {
  const st = getLoginState(slug);
  if (st.timer) clearTimeout(st.timer);
  st.timer = setTimeout(() => {
    if (st.proc) st.proc.kill();
    st.proc = null;
    st.kind = null;
    st.url = null;
    st.buffer = '';
    st.status = 'error';
    st.message = 'タイムアウトしました。もう一度お試しください。';
    broadcast();
  }, INACTIVITY_TIMEOUT_MS);
}

// kind: 'login' = サブスクリプションログイン / 'token' = 1年有効な長期トークンの発行。
// どちらもブラウザで URL を開いてコードを貼り戻す同じ流れなので、処理を共有する。
function startAuthFlow(slug, kind) {
  const st = getLoginState(slug);
  if (st.proc) return;
  st.buffer = '';
  st.url = null;
  st.message = '';
  st.kind = kind;
  st.status = 'starting';
  broadcast();

  // `claude setup-token` は Ink（対話 UI）で動くため、端末が無いと何も出力せず
  // 固まる。`script` で疑似端末を用意して動かす。あわせて `stty cols` で端末幅を
  // 広く取り、URL やトークンが折り返されて途中で切れないようにする
  // （実測: 既定の80桁だと URL が5行に折り返される）。
  // `claude auth login` のほうは端末なしでも動くので、そのまま起動する。
  const [cmd, args] = kind === 'token'
    ? ['script', ['-qec', `stty cols ${PTY_COLS} rows ${PTY_ROWS}; claude setup-token`, '/dev/null']]
    : ['claude', ['auth', 'login', '--claudeai']];
  // 発行・ログインのときは既存の長期トークンを渡さない（CLI がそちらを使って
  // しまい、フローが始まらないのを避けるため）。
  const proc = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: claudeEnv(slug, { withToken: false }),
  });
  st.proc = proc;
  resetTimer(slug);

  const onData = (chunk) => {
    st.buffer += chunk.toString();
    const url = extractUrl(st.buffer);
    if (url) st.url = url;
    if (/invalid\s*code/i.test(stripAnsi(st.buffer).split('\n').slice(-3).join('\n'))) {
      st.status = 'invalid';
    } else if (st.url) {
      st.status = 'waiting';
    }
    resetTimer(slug);
    broadcast();
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);

  proc.on('close', (code) => {
    if (st.timer) clearTimeout(st.timer);
    st.proc = null;

    if (kind === 'token') {
      // 出力にトークンが含まれていれば保存する。バッファは即座に捨てる
      // （トークンがメモリやログに残らないように）。
      const token = extractToken(st.buffer);
      st.buffer = '';
      st.url = null;
      if (token) {
        saveToken(slug, token);
        getHealth(slug).lastPingAuthError = false;
        st.status = 'success';
        st.message = '長期トークンを発行して保存しました（有効期間: 約1年）。';
        log(`[${accountLabel(slug)}] 長期トークンを保存しました（有効期間: 約1年）`);
      } else {
        st.status = 'error';
        st.message = code === 0
          ? '出力からトークンを取り出せませんでした。パソコンで `claude setup-token` を実行し、'
            + '表示されたトークンを下の欄に貼り付けてください。'
          : `トークンの発行が終了しました（終了コード: ${code}）。もう一度お試しください。`;
      }
    } else {
      st.buffer = '';
      st.url = null;
      if (code === 0) {
        getHealth(slug).lastPingAuthError = false;
        st.status = 'success';
        st.message = 'ログインに成功しました。';
      } else {
        st.status = 'error';
        st.message = `ログイン処理が終了しました（終了コード: ${code}）。もう一度お試しください。`;
      }
    }
    st.kind = null;
    broadcast();

    const account = findAccount(slug);
    if (account) evaluateHealth(account).catch((e) => logError(`認証チェックに失敗: ${e.message}`));
  });
}

function submitCode(slug, code) {
  const st = getLoginState(slug);
  if (!st.proc || !code) return;
  const retryFirst = st.kind === 'token' && st.status === 'invalid';
  st.status = 'submitting';
  // 疑似端末側（setup-token）では Enter は CR。LF だと確定されない。
  const eol = st.kind === 'token' ? '\r' : '\n';
  const write = () => { if (st.proc) st.proc.stdin.write(code.trim() + eol); };
  if (retryFirst) {
    // setup-token はコードを間違えると「Press Enter to retry」で止まる。
    // 先に Enter を送って入力欄に戻さないと、次に打ったコードが捨てられる。
    st.proc.stdin.write('\r');
    setTimeout(write, 700);
  } else {
    write();
  }
  resetTimer(slug);
  broadcast();
}

function cancelLogin(slug) {
  const st = getLoginState(slug);
  if (st.proc) st.proc.kill();
  if (st.timer) clearTimeout(st.timer);
  st.proc = null;
  st.kind = null;
  st.url = null;
  st.buffer = '';
  st.status = 'idle';
  st.message = '';
  broadcast();
}

// パソコンで `claude setup-token` を実行した場合の貼り付け経路。
// UI 内での発行がうまくいかないときの逃げ道として用意する。
function saveTokenManually(slug, token) {
  const st = getLoginState(slug);
  const value = String(token || '').trim();
  if (!looksLikeToken(value)) {
    st.status = 'error';
    st.message = 'トークンの形式が違うようです（sk-ant- で始まる文字列を貼り付けてください）。';
    broadcast();
    return;
  }
  saveToken(slug, value);
  getHealth(slug).lastPingAuthError = false;
  st.status = 'success';
  st.message = '長期トークンを保存しました（有効期間: 約1年）。';
  log(`[${accountLabel(slug)}] 貼り付けられた長期トークンを保存しました`);
  broadcast();
  const account = findAccount(slug);
  if (account) evaluateHealth(account).catch((e) => logError(`認証チェックに失敗: ${e.message}`));
}

function removeToken(slug) {
  deleteToken(slug);
  const h = getHealth(slug);
  h.lastPingAuthError = false;
  h.expiringNotified = false;
  const st = getLoginState(slug);
  st.status = 'idle';
  st.message = '';
  log(`[${accountLabel(slug)}] 長期トークンを削除しました`);
  broadcast();
  const account = findAccount(slug);
  if (account) evaluateHealth(account).catch((e) => logError(`認証チェックに失敗: ${e.message}`));
}

// --- 画面状態 ---

function computeViewState() {
  const accounts = loadAccounts();
  return {
    notifyEnabled: notifyEnabled(),
    accounts: accounts.map((account) => {
      const st = getLoginState(account.slug);
      const h = getHealth(account.slug);
      const base = {
        slug: account.slug,
        name: account.name,
        scheduleTime: account.scheduleTime,
        healthy: h.healthy,
        reason: h.reason,
      };

      if (st.proc) {
        return { ...base, mode: st.kind === 'token' ? 'issuing_token' : 'logging_in', url: st.url, status: st.status };
      }

      const notice = st.status === 'error' ? st.message : '';
      const rec = readToken(account.slug);
      if (rec) {
        const left = tokenDaysLeft(rec);
        return { ...base, mode: 'token', daysLeft: left, notice };
      }

      const auth = getAuthStatus(account.slug);
      if (auth && auth.loggedIn) {
        return { ...base, mode: 'logged_in', authMethod: auth.authMethod || '不明', notice };
      }
      return { ...base, mode: 'logged_out', notice };
    }),
  };
}

function broadcast() {
  const payload = `data: ${JSON.stringify(computeViewState())}\n\n`;
  for (const res of clients) res.write(payload);
}

// --- HTML ---

const SHELL_HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>Claude Session Opener - ログイン</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; color: #2b1a12; }
  h1 { font-size: 1.3rem; }
  h2 { font-size: 1.05rem; margin: 1.6rem 0 0.4rem; }
  .card { background: #FDF6EC; border: 1px solid #E8956B; border-radius: 12px; padding: 1.2rem 1.5rem; margin-bottom: 1rem; }
  .ok { color: #2f7d3a; font-weight: bold; }
  .warn { color: #b3401f; font-weight: bold; }
  .muted { color: #6b584e; }
  button { display: inline-block; background: #C1613C; color: #fff; border: none; border-radius: 8px;
    padding: 0.6rem 1.2rem; font-size: 1rem; cursor: pointer; margin: 0.2rem 0.3rem 0.2rem 0; }
  button:hover { background: #A6502F; }
  button:disabled { background: #ccc; cursor: default; }
  button.secondary { background: #888; }
  button.secondary:hover { background: #666; }
  input[type=text] { width: 100%; padding: 0.5rem; font-size: 1rem; box-sizing: border-box; margin-bottom: 0.6rem; }
  .url-box { word-break: break-all; background: #fff; border: 1px dashed #C1613C; padding: 0.6rem; border-radius: 6px; margin: 0.6rem 0; }
  details { margin-top: 0.8rem; }
  summary { cursor: pointer; color: #6b584e; }
  #app { min-height: 4rem; }
</style>
</head>
<body>
<h1>Claude Session Opener - サブスクリプションログイン</h1>
<div id="app"><p>読み込み中…</p></div>
<p><small>詳細はアドオンの README を参照してください。実行ログは HA の「ログ」タブに出力されます。</small></p>
<script>
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

var app = document.getElementById('app');

function post(action, body) {
  return fetch(action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
}

function tokenPasteBlock(s, summaryText) {
  return '<details><summary>' + esc(summaryText) + '</summary>' +
    '<p class="muted">パソコンのターミナルで <code>claude setup-token</code> を実行し、表示されたトークンを貼り付けても登録できます。</p>' +
    '<form data-slug="' + esc(s.slug) + '" class="tokenForm">' +
    '<input type="text" name="token" autocomplete="off" placeholder="sk-ant-...">' +
    '<button type="submit">トークンを保存</button>' +
    '</form></details>';
}

function renderAccount(s) {
  var header = '<h2>' + esc(s.name) + '（毎日 ' + esc(s.scheduleTime) + ' UTC）</h2>';
  var notice = s.notice ? '<p class="warn">' + esc(s.notice) + '</p>' : '';

  if (s.mode === 'logging_in' || s.mode === 'issuing_token') {
    var isToken = s.mode === 'issuing_token';
    var urlHtml = s.url
      ? '<p>以下の URL を自分のブラウザで開いて認証してください。</p>' +
        '<div class="url-box"><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.url) + '</a></div>'
      : '<p>認証 URL を取得中です…</p>';
    var invalidMsg = s.status === 'invalid'
      ? '<p class="warn">コードが正しくないか、コピーが不完全なようです。もう一度貼り付けてください。</p>' : '';
    var submitting = s.status === 'submitting';
    return header +
      '<div class="card">' +
      (isToken ? '<p><b>長期トークン（1年有効）を発行しています。</b></p>' : '') +
      urlHtml + invalidMsg +
      '<form data-slug="' + esc(s.slug) + '" class="codeForm">' +
      '<label>認証後に表示されるコードを貼り付けてください' +
      '<input type="text" name="code" autocomplete="off" placeholder="認証コード"' + (submitting ? ' disabled' : '') + '>' +
      '</label>' +
      '<button type="submit"' + (submitting ? ' disabled' : '') + '>' + (submitting ? '確認中…' : '送信') + '</button>' +
      '</form>' +
      '<button class="secondary" data-action="cancel" data-slug="' + esc(s.slug) + '">キャンセル</button>' +
      '</div>';
  }

  if (s.mode === 'token') {
    var left = s.daysLeft;
    var expiry = left === null || left === undefined
      ? '<p class="ok">✅ 長期トークンで認証しています（有効期間: 約1年）</p>'
      : (left <= 0
        ? '<p class="warn">⚠️ 長期トークンの有効期限が切れています。再発行してください。</p>'
        : '<p class="' + (left <= 14 ? 'warn' : 'ok') + '">' + (left <= 14 ? '⚠️' : '✅') +
          ' 長期トークンで認証しています（残り約 ' + esc(left) + ' 日）</p>');
    var unhealthy = s.healthy === false && s.reason
      ? '<p class="warn">' + esc(s.reason) + '</p>' : '';
    return header + '<div class="card">' + expiry + unhealthy + notice +
      '<p class="muted">ログインの有効期限切れでセッションが止まらないよう、1年有効なトークンを使っています。</p>' +
      '<button data-action="token" data-slug="' + esc(s.slug) + '">長期トークンを再発行</button>' +
      '<button class="secondary" data-action="token-delete" data-slug="' + esc(s.slug) + '">トークンを削除</button>' +
      tokenPasteBlock(s, '手元で発行したトークンを貼り付ける') +
      '</div>';
  }

  if (s.mode === 'logged_in') {
    return header +
      '<div class="card"><p class="ok">✅ ログイン済みです（認証方式: ' + esc(s.authMethod) + '）</p>' + notice +
      '<p class="muted">ログインの有効期限は短く、切れるとその都度ログインし直しになります。' +
      '<b>1年有効な長期トークン</b>に切り替えておくことをおすすめします。</p>' +
      '<button data-action="token" data-slug="' + esc(s.slug) + '">長期トークンを発行（1年有効・推奨）</button>' +
      '<button class="secondary" data-action="start" data-slug="' + esc(s.slug) + '">再ログイン</button>' +
      tokenPasteBlock(s, '手元で発行したトークンを貼り付ける') +
      '</div>';
  }

  // logged_out
  return header +
    '<div class="card"><p class="warn">未ログインです。</p>' + notice +
    '<p>Claude Pro/Max サブスクリプションアカウントで認証してください。' +
    '<b>長期トークン</b>なら1年有効なので、毎回ログインし直す必要がありません。</p>' +
    '<button data-action="token" data-slug="' + esc(s.slug) + '">長期トークンを発行（1年有効・推奨）</button>' +
    '<button class="secondary" data-action="start" data-slug="' + esc(s.slug) + '">ログインを開始</button>' +
    tokenPasteBlock(s, '手元で発行したトークンを貼り付ける') +
    '</div>';
}

function render(state) {
  if (!state.accounts || state.accounts.length === 0) {
    app.innerHTML = '<div class="card"><p>アカウントが設定されていません。アドオンの設定タブで accounts を追加してください。</p></div>';
    return;
  }
  var banner = state.notifyEnabled ? ''
    : '<p class="muted">Home Assistant への通知は設定タブで無効にされています。</p>';
  app.innerHTML = banner + state.accounts.map(renderAccount).join('');

  var actions = { start: 'start', token: 'token/start', cancel: 'cancel', 'token-delete': 'token/delete' };
  app.querySelectorAll('button[data-action]').forEach(function (btn) {
    var url = actions[btn.dataset.action];
    if (!url) return;
    btn.onclick = function () {
      if (btn.dataset.action === 'token-delete' && !confirm('長期トークンを削除しますか？')) return;
      post(url, { account: btn.dataset.slug });
    };
  });
  app.querySelectorAll('form.codeForm').forEach(function (form) {
    form.onsubmit = function (e) {
      e.preventDefault();
      var code = form.code.value;
      if (!code) return;
      post('submit', { account: form.dataset.slug, code: code });
    };
  });
  app.querySelectorAll('form.tokenForm').forEach(function (form) {
    form.onsubmit = function (e) {
      e.preventDefault();
      var token = form.token.value;
      if (!token) return;
      form.token.value = '';
      post('token/save', { account: form.dataset.slug, token: token });
    };
  });
}

function connect() {
  var es = new EventSource('events');
  es.onmessage = function (e) { render(JSON.parse(e.data)); };
  es.onerror = function () {
    app.innerHTML = '<div class="card"><p class="warn">サーバーとの接続が切れました。再接続しています…</p></div>';
  };
}
connect();
</script>
</body>
</html>`;

// --- HTTP サーバー ---

const POST_ROUTES = new Set(['/start', '/submit', '/cancel', '/token/start', '/token/save', '/token/delete']);

const server = http.createServer((req, res) => {
  const reqPath = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';

  if (req.method === 'GET' && reqPath === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(SHELL_HTML);
    return;
  }

  if (req.method === 'GET' && reqPath === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    res.write(`data: ${JSON.stringify(computeViewState())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (req.method === 'POST' && POST_ROUTES.has(reqPath)) {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let parsed = {};
      try { parsed = body ? JSON.parse(body) : {}; } catch (e) { /* ignore malformed body */ }
      const slug = parsed.account;
      const known = loadAccounts().some((a) => a.slug === slug);
      if (known) {
        if (reqPath === '/start') startAuthFlow(slug, 'login');
        if (reqPath === '/token/start') startAuthFlow(slug, 'token');
        if (reqPath === '/submit') submitCode(slug, parsed.code);
        if (reqPath === '/cancel') cancelLogin(slug);
        if (reqPath === '/token/save') saveTokenManually(slug, parsed.token);
        if (reqPath === '/token/delete') removeToken(slug);
      }
      res.writeHead(204);
      res.end();
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

setInterval(() => {
  for (const res of clients) res.write(': heartbeat\n\n');
}, HEARTBEAT_MS);

setInterval(schedulerTick, SCHEDULER_TICK_MS);
setInterval(healthTick, HEALTH_CHECK_MS);

server.listen(PORT, '0.0.0.0', () => {
  log(`Claude Session Opener listening on :${PORT}`);
  const accounts = loadAccounts();
  if (accounts.length === 0) {
    log('警告: accounts が設定されていません。アドオンの設定タブで追加してください。');
  } else {
    for (const a of accounts) log(`アカウント "${a.name}": 毎日 ${a.scheduleTime} (UTC) に実行`);
  }
  if (!notifyEnabled()) log('Home Assistant への通知は無効です。');
  healthTick();
});
