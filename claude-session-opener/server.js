'use strict';

// Claude Session Opener のメインプロセス。以下をまとめて担当する。
//   1. アカウントごとの schedule_time になったら `claude -p "ok"` を実行するスケジューラ
//   2. Ingress 経由のログイン用 Web UI（Server-Sent Events でリアルタイム更新）
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
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
const HEARTBEAT_MS = 25 * 1000;
const SCHEDULER_TICK_MS = 20 * 1000;

// slug -> { proc, url, status, message, timer }  (ログイン処理の状態)
const loginStates = new Map();
// slug -> "YYYY-MM-DD HH:MM" (直近に発火した分。同じ分での二重発火を防ぐ)
const lastFiredMinute = new Map();

const clients = new Set();

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function slugify(name, index) {
  const base = String(name || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return base || `account${index + 1}`;
}

function loadAccounts() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(OPTIONS_PATH, 'utf8'));
  } catch (e) {
    return [];
  }
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

function getLoginState(slug) {
  if (!loginStates.has(slug)) {
    loginStates.set(slug, { proc: null, buffer: '', url: null, status: 'idle', message: '', timer: null });
  }
  return loginStates.get(slug);
}

function getAuthStatus(slug) {
  try {
    const dir = credDir(slug);
    fs.mkdirSync(dir, { recursive: true });
    const out = execFileSync('claude', ['auth', 'status', '--json'], {
      timeout: 10000,
      env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
    }).toString();
    return JSON.parse(out);
  } catch (e) {
    return null;
  }
}

// --- スケジューラ: ping ---

function runPing(account) {
  const dir = credDir(account.slug);
  fs.mkdirSync(dir, { recursive: true });

  const proc = spawn(
    'claude',
    ['-p', 'ok', '--model', 'haiku', '--output-format', 'json', '--no-session-persistence'],
    { env: { ...process.env, CLAUDE_CONFIG_DIR: dir } },
  );

  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (c) => { stdout += c; });
  proc.stderr.on('data', (c) => { stderr += c; });

  proc.on('close', (code) => {
    if (stderr) console.error(`[${account.name}] stderr: ${stderr}`);

    let summary;
    if (code !== 0) {
      summary = `コマンドが失敗しました（終了コード: ${code}）: ${(stdout + stderr).slice(0, 300)}`;
    } else {
      try {
        const j = JSON.parse(stdout);
        summary = j.is_error
          ? `エラー: ${j.result || j.subtype || 'unknown'}`
          : `成功: 応答=${JSON.stringify(j.result)} session_id=${j.session_id}`;
      } catch (e) {
        summary = `応答の解析に失敗しました: ${stdout.slice(0, 300)}`;
      }
    }
    console.log(`[${account.name}] セッションオープナー実行結果: ${summary}`);
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
    console.log(`[${account.name}] セッションオープナーを実行します...`);
    runPing(account);
  }
}

// --- ログインフロー ---

function extractUrl(text) {
  const matches = text.match(/https:\/\/\S+/g);
  return matches ? matches[matches.length - 1] : null;
}

function resetTimer(slug) {
  const st = getLoginState(slug);
  if (st.timer) clearTimeout(st.timer);
  st.timer = setTimeout(() => {
    if (st.proc) st.proc.kill();
    st.proc = null;
    st.url = null;
    st.buffer = '';
    st.status = 'error';
    st.message = 'タイムアウトしました。もう一度お試しください。';
    broadcast();
  }, INACTIVITY_TIMEOUT_MS);
}

function startLogin(slug) {
  const st = getLoginState(slug);
  if (st.proc) return;
  st.buffer = '';
  st.url = null;
  st.message = '';
  st.status = 'starting';
  broadcast();

  const dir = credDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  const proc = spawn('claude', ['auth', 'login', '--claudeai'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
  });
  st.proc = proc;
  resetTimer(slug);

  const onData = (chunk) => {
    st.buffer += chunk.toString();
    const url = extractUrl(st.buffer);
    if (url) st.url = url;
    if (/invalid code/i.test(st.buffer.split('\n').slice(-3).join('\n'))) {
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
    if (code === 0) {
      st.status = 'success';
      st.message = 'ログインに成功しました。';
    } else {
      st.status = 'error';
      st.message = `ログイン処理が終了しました（終了コード: ${code}）。もう一度お試しください。`;
    }
    broadcast();
  });
}

function submitCode(slug, code) {
  const st = getLoginState(slug);
  if (!st.proc || !code) return;
  st.status = 'submitting';
  st.proc.stdin.write(code.trim() + '\n');
  resetTimer(slug);
  broadcast();
}

function cancelLogin(slug) {
  const st = getLoginState(slug);
  if (st.proc) st.proc.kill();
  if (st.timer) clearTimeout(st.timer);
  st.proc = null;
  st.url = null;
  st.buffer = '';
  st.status = 'idle';
  st.message = '';
  broadcast();
}

// --- 画面状態 ---

function computeViewState() {
  const accounts = loadAccounts();
  return {
    accounts: accounts.map((account) => {
      const st = getLoginState(account.slug);
      const base = { slug: account.slug, name: account.name, scheduleTime: account.scheduleTime };
      if (st.proc) {
        return { ...base, mode: 'logging_in', url: st.url, status: st.status };
      }
      const auth = getAuthStatus(account.slug);
      if (auth && auth.loggedIn) {
        return { ...base, mode: 'logged_in', authMethod: auth.authMethod || '不明', justSucceeded: st.status === 'success' };
      }
      return { ...base, mode: 'logged_out', error: st.status === 'error' ? st.message : '' };
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
  button { display: inline-block; background: #C1613C; color: #fff; border: none; border-radius: 8px;
    padding: 0.6rem 1.2rem; font-size: 1rem; cursor: pointer; }
  button:hover { background: #A6502F; }
  button:disabled { background: #ccc; cursor: default; }
  button.secondary { background: #888; }
  button.secondary:hover { background: #666; }
  input[type=text] { width: 100%; padding: 0.5rem; font-size: 1rem; box-sizing: border-box; margin-bottom: 0.6rem; }
  .url-box { word-break: break-all; background: #fff; border: 1px dashed #C1613C; padding: 0.6rem; border-radius: 6px; margin: 0.6rem 0; }
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

function renderAccount(s) {
  var header = '<h2>' + esc(s.name) + '（毎日 ' + esc(s.scheduleTime) + ' UTC）</h2>';

  if (s.mode === 'logged_in') {
    var tip = s.justSucceeded
      ? '<p class="ok">Claude Code 内で <code>/usage</code> を実行し、5時間セッションが起点になっているか確認してください。</p>'
      : '';
    return header +
      '<div class="card"><p class="ok">✅ ログイン済みです（認証方式: ' + esc(s.authMethod) + '）</p>' + tip +
      '<p>別のアカウントで再ログインする場合は以下から開始してください。</p>' +
      '<button data-action="start" data-slug="' + esc(s.slug) + '">再ログインを開始</button></div>';
  }

  if (s.mode === 'logging_in') {
    var urlHtml = s.url
      ? '<p>以下の URL を自分のブラウザで開いてログインしてください。</p>' +
        '<div class="url-box"><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.url) + '</a></div>'
      : '<p>認証 URL を取得中です…</p>';
    var invalidMsg = s.status === 'invalid'
      ? '<p class="warn">コードが正しくないか、コピーが不完全なようです。もう一度貼り付けてください。</p>' : '';
    var submitting = s.status === 'submitting';
    return header +
      '<div class="card">' + urlHtml + invalidMsg +
      '<form data-slug="' + esc(s.slug) + '" class="codeForm">' +
      '<label>ログイン後に表示される認証コードを貼り付けてください' +
      '<input type="text" name="code" autocomplete="off" placeholder="認証コード"' + (submitting ? ' disabled' : '') + '>' +
      '</label>' +
      '<button type="submit"' + (submitting ? ' disabled' : '') + '>' + (submitting ? '確認中…' : '送信') + '</button>' +
      '</form>' +
      '<button class="secondary" data-action="cancel" data-slug="' + esc(s.slug) + '" style="margin-top:0.6rem">キャンセル</button>' +
      '</div>';
  }

  // logged_out
  return header +
    '<div class="card"><p>未ログインです。Claude Pro/Max サブスクリプションアカウントでログインしてください。</p>' +
    (s.error ? '<p class="warn">' + esc(s.error) + '</p>' : '') +
    '<button data-action="start" data-slug="' + esc(s.slug) + '">ログインを開始</button></div>';
}

function render(state) {
  if (!state.accounts || state.accounts.length === 0) {
    app.innerHTML = '<div class="card"><p>アカウントが設定されていません。アドオンの設定タブで accounts を追加してください。</p></div>';
    return;
  }
  app.innerHTML = state.accounts.map(renderAccount).join('');

  app.querySelectorAll('button[data-action="start"]').forEach(function (btn) {
    btn.onclick = function () { post('start', { account: btn.dataset.slug }); };
  });
  app.querySelectorAll('button[data-action="cancel"]').forEach(function (btn) {
    btn.onclick = function () { post('cancel', { account: btn.dataset.slug }); };
  });
  app.querySelectorAll('form.codeForm').forEach(function (form) {
    form.onsubmit = function (e) {
      e.preventDefault();
      var code = form.code.value;
      if (!code) return;
      post('submit', { account: form.dataset.slug, code: code });
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

  if (req.method === 'POST' && (reqPath === '/start' || reqPath === '/submit' || reqPath === '/cancel')) {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let parsed = {};
      try { parsed = body ? JSON.parse(body) : {}; } catch (e) { /* ignore malformed body */ }
      const slug = parsed.account;
      const known = loadAccounts().some((a) => a.slug === slug);
      if (known) {
        if (reqPath === '/start') startLogin(slug);
        if (reqPath === '/submit') submitCode(slug, parsed.code);
        if (reqPath === '/cancel') cancelLogin(slug);
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Claude Session Opener listening on :${PORT}`);
  const accounts = loadAccounts();
  if (accounts.length === 0) {
    console.log('警告: accounts が設定されていません。アドオンの設定タブで追加してください。');
  } else {
    for (const a of accounts) console.log(`アカウント "${a.name}": 毎日 ${a.scheduleTime} (UTC) に実行`);
  }
});
