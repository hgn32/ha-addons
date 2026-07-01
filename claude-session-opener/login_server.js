'use strict';

// アドオン単体（Ingress 経由のブラウザ画面）で `claude auth login --claudeai` の
// 認証コードのやり取りを完結させるための HTTP サーバー。
// 外部パッケージには依存せず Node.js 標準モジュールのみを使用する。
//
// サーバー側の状態遷移を Server-Sent Events (/events) でブラウザへプッシュし、
// クライアントはボタン操作を fetch() で送るだけの単純な状態同期モデル。
// ページ全体のリロードやタイマーによるポーリングは行わない。

const http = require('http');
const { spawn, execFileSync } = require('child_process');

const PORT = 8099;
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
const HEARTBEAT_MS = 25 * 1000;

const state = {
  proc: null,
  buffer: '',
  url: null,
  status: 'idle', // idle | starting | waiting | invalid | submitting | success | error
  message: '',
  timer: null,
};

const clients = new Set();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function getAuthStatus() {
  try {
    const out = execFileSync('claude', ['auth', 'status', '--json'], { timeout: 10000 }).toString();
    return JSON.parse(out);
  } catch (e) {
    return null;
  }
}

// サーバー側の内部状態から、クライアントに送る「見た目の状態」を組み立てる。
function computeViewState() {
  if (state.proc) {
    return {
      mode: 'logging_in',
      url: state.url,
      status: state.status, // starting | waiting | invalid | submitting
    };
  }
  const auth = getAuthStatus();
  if (auth && auth.loggedIn) {
    return {
      mode: 'logged_in',
      authMethod: auth.authMethod || '不明',
      justSucceeded: state.status === 'success',
    };
  }
  return {
    mode: 'logged_out',
    error: state.status === 'error' ? state.message : '',
  };
}

function broadcast() {
  const payload = `data: ${JSON.stringify(computeViewState())}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}

function resetTimer() {
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    if (state.proc) state.proc.kill();
    state.proc = null;
    state.url = null;
    state.buffer = '';
    state.status = 'error';
    state.message = 'タイムアウトしました。もう一度お試しください。';
    broadcast();
  }, INACTIVITY_TIMEOUT_MS);
}

function extractUrl(text) {
  const matches = text.match(/https:\/\/\S+/g);
  return matches ? matches[matches.length - 1] : null;
}

function startLogin() {
  if (state.proc) return;
  state.buffer = '';
  state.url = null;
  state.message = '';
  state.status = 'starting';
  broadcast();

  const proc = spawn('claude', ['auth', 'login', '--claudeai'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  state.proc = proc;
  resetTimer();

  const onData = (chunk) => {
    state.buffer += chunk.toString();
    const url = extractUrl(state.buffer);
    if (url) state.url = url;
    if (/invalid code/i.test(state.buffer.split('\n').slice(-3).join('\n'))) {
      state.status = 'invalid';
    } else if (state.url) {
      state.status = 'waiting';
    }
    resetTimer();
    broadcast();
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);

  proc.on('close', (code) => {
    if (state.timer) clearTimeout(state.timer);
    state.proc = null;
    if (code === 0) {
      state.status = 'success';
      state.message = 'ログインに成功しました。';
    } else {
      state.status = 'error';
      state.message = 'ログイン処理が終了しました（終了コード: ' + code + '）。もう一度お試しください。';
    }
    broadcast();
  });
}

function submitCode(code) {
  if (!state.proc || !code) return;
  state.status = 'submitting';
  state.proc.stdin.write(code.trim() + '\n');
  resetTimer();
  broadcast();
}

function cancelLogin() {
  if (state.proc) state.proc.kill();
  if (state.timer) clearTimeout(state.timer);
  state.proc = null;
  state.url = null;
  state.buffer = '';
  state.status = 'idle';
  state.message = '';
  broadcast();
}

const SHELL_HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>Claude Session Opener - ログイン</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; color: #2b1a12; }
  h1 { font-size: 1.3rem; }
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
<p><small>このアドオンは試験的機能です。詳細はアドオンの README を参照してください。</small></p>
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

function render(s) {
  if (s.mode === 'logged_in') {
    var tip = s.justSucceeded
      ? '<p class="ok">Claude Code 内で <code>/usage</code> を実行し、5時間セッションが起点になっているか確認してください。</p>'
      : '';
    app.innerHTML =
      '<div class="card"><p class="ok">✅ ログイン済みです（認証方式: ' + esc(s.authMethod) + '）</p>' + tip + '</div>' +
      '<div class="card"><p>別のアカウントで再ログインする場合は以下から開始してください。</p>' +
      '<button id="startBtn">再ログインを開始</button></div>';
    document.getElementById('startBtn').onclick = function () { post('start'); };
    return;
  }

  if (s.mode === 'logging_in') {
    var urlHtml = s.url
      ? '<p>以下の URL を自分のブラウザで開いてログインしてください。</p>' +
        '<div class="url-box"><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.url) + '</a></div>'
      : '<p>認証 URL を取得中です…</p>';
    var invalidMsg = s.status === 'invalid'
      ? '<p class="warn">コードが正しくないか、コピーが不完全なようです。もう一度貼り付けてください。</p>' : '';
    var submitting = s.status === 'submitting';
    app.innerHTML =
      '<div class="card">' + urlHtml + invalidMsg +
      '<form id="codeForm">' +
      '<label for="code">ログイン後に表示される認証コードを貼り付けてください</label>' +
      '<input type="text" id="code" name="code" autocomplete="off" placeholder="認証コード"' + (submitting ? ' disabled' : '') + '>' +
      '<button type="submit"' + (submitting ? ' disabled' : '') + '>' + (submitting ? '確認中…' : '送信') + '</button>' +
      '</form>' +
      '<button id="cancelBtn" class="secondary" style="margin-top:0.6rem">キャンセル</button>' +
      '</div>';
    var form = document.getElementById('codeForm');
    form.onsubmit = function (e) {
      e.preventDefault();
      var code = document.getElementById('code').value;
      if (!code) return;
      post('submit', { code: code });
    };
    document.getElementById('cancelBtn').onclick = function () { post('cancel'); };
    return;
  }

  // logged_out
  app.innerHTML =
    '<div class="card"><p>未ログインです。Claude Pro/Max サブスクリプションアカウントでログインしてください。</p>' +
    (s.error ? '<p class="warn">' + esc(s.error) + '</p>' : '') +
    '<button id="startBtn">ログインを開始</button></div>';
  document.getElementById('startBtn').onclick = function () { post('start'); };
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

const server = http.createServer((req, res) => {
  const path = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';

  if (req.method === 'GET' && path === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(SHELL_HTML);
    return;
  }

  if (req.method === 'GET' && path === '/events') {
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

  if (req.method === 'POST' && (path === '/start' || path === '/submit' || path === '/cancel')) {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let parsed = {};
      try { parsed = body ? JSON.parse(body) : {}; } catch (e) { /* ignore malformed body */ }
      if (path === '/start') startLogin();
      if (path === '/submit') submitCode(parsed.code);
      if (path === '/cancel') cancelLogin();
      res.writeHead(204);
      res.end();
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

// Ingress プロキシ等でアイドル接続が切られないよう、SSE 接続に定期的にコメント行を送る。
setInterval(() => {
  for (const res of clients) res.write(': heartbeat\n\n');
}, HEARTBEAT_MS);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`login_server listening on :${PORT}`);
});
