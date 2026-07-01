'use strict';

// アドオン単体（Ingress 経由のブラウザ画面）で `claude auth login --claudeai` の
// 認証コードのやり取りを完結させるための最小限の HTTP サーバー。
// 外部パッケージには依存せず Node.js 標準モジュールのみを使用する。

const http = require('http');
const { spawn, execFileSync } = require('child_process');
const querystring = require('querystring');

const PORT = 8099;
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;

const state = {
  proc: null,
  buffer: '',
  url: null,
  status: 'idle', // idle | starting | waiting | invalid | submitting | success | error
  message: '',
  timer: null,
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function resetTimer() {
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    if (state.proc) {
      state.proc.kill();
    }
    state.status = 'idle';
    state.message = 'タイムアウトしました。もう一度お試しください。';
    state.proc = null;
    state.url = null;
    state.buffer = '';
  }, INACTIVITY_TIMEOUT_MS);
}

function extractUrl(text) {
  const matches = text.match(/https:\/\/\S+/g);
  return matches ? matches[matches.length - 1] : null;
}

function getAuthStatus() {
  try {
    const out = execFileSync('claude', ['auth', 'status', '--json'], { timeout: 10000 }).toString();
    return JSON.parse(out);
  } catch (e) {
    return null;
  }
}

function startLogin() {
  if (state.proc) return;
  state.buffer = '';
  state.url = null;
  state.message = '';
  state.status = 'starting';

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
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);

  proc.on('close', (code) => {
    if (state.timer) clearTimeout(state.timer);
    state.proc = null;
    if (code === 0) {
      state.status = 'success';
      state.message = 'ログインに成功しました。';
    } else if (state.status !== 'idle') {
      state.status = 'error';
      state.message = 'ログイン処理が終了しました（終了コード: ' + code + '）。もう一度お試しください。';
    }
  });
}

function submitCode(code) {
  if (!state.proc || !code) return;
  state.status = 'submitting';
  state.proc.stdin.write(code.trim() + '\n');
  resetTimer();
}

function cancelLogin() {
  if (state.proc) state.proc.kill();
  if (state.timer) clearTimeout(state.timer);
  state.proc = null;
  state.url = null;
  state.buffer = '';
  state.status = 'idle';
  state.message = '';
}

function page(bodyHtml, refresh) {
  const meta = refresh ? '<meta http-equiv="refresh" content="2">' : '';
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
${meta}
<title>Claude Session Opener - ログイン</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; color: #2b1a12; }
  h1 { font-size: 1.3rem; }
  .card { background: #FDF6EC; border: 1px solid #E8956B; border-radius: 12px; padding: 1.2rem 1.5rem; margin-bottom: 1rem; }
  .ok { color: #2f7d3a; font-weight: bold; }
  .warn { color: #b3401f; font-weight: bold; }
  a.btn, button { display: inline-block; background: #C1613C; color: #fff; border: none; border-radius: 8px;
    padding: 0.6rem 1.2rem; font-size: 1rem; cursor: pointer; text-decoration: none; }
  a.btn:hover, button:hover { background: #A6502F; }
  input[type=text] { width: 100%; padding: 0.5rem; font-size: 1rem; box-sizing: border-box; margin-bottom: 0.6rem; }
  .url-box { word-break: break-all; background: #fff; border: 1px dashed #C1613C; padding: 0.6rem; border-radius: 6px; margin: 0.6rem 0; }
  form { margin: 0; }
</style>
</head>
<body>
<h1>Claude Session Opener - サブスクリプションログイン</h1>
${bodyHtml}
<p><small>このアドオンは試験的機能です。詳細はアドオンの README を参照してください。</small></p>
</body>
</html>`;
}

function renderIndex() {
  if (!state.proc) {
    const auth = getAuthStatus();
    if (auth && auth.loggedIn) {
      const isOauth = /oauth/i.test(auth.authMethod || '');
      const authLabel = isOauth ? 'サブスクリプション（OAuth）' : (auth.authMethod || '不明');
      const warn = isOauth ? '' : `<p class="warn">認証方式が OAuth ではありません（${escapeHtml(authLabel)}）。
        ANTHROPIC_API_KEY が設定されていないか確認してください。設定されている場合、
        従量課金 API になり5時間セッションの起点にはなりません。</p>`;
      return page(`
        <div class="card">
          <p class="ok">✅ ログイン済みです（認証方式: ${escapeHtml(authLabel)}）</p>
          ${warn}
        </div>
        <div class="card">
          <p>別のアカウントで再ログインする場合は以下から開始してください。</p>
          <form method="POST" action="start"><button type="submit">再ログインを開始</button></form>
        </div>
      `, false);
    }

    if (state.status === 'success') {
      return page(`
        <div class="card">
          <p class="ok">✅ ${escapeHtml(state.message || 'ログインに成功しました。')}</p>
          <p>Claude Code 内で <code>/usage</code> を実行し、5時間セッションが起点になっているか確認してください。</p>
        </div>
      `, false);
    }

    const errMsg = state.status === 'error' || state.status === 'idle' ? state.message : '';
    return page(`
      <div class="card">
        <p>未ログインです。Claude Pro/Max サブスクリプションアカウントでログインしてください。</p>
        ${errMsg ? `<p class="warn">${escapeHtml(errMsg)}</p>` : ''}
        <form method="POST" action="start"><button type="submit">ログインを開始</button></form>
      </div>
    `, false);
  }

  // ログインプロセス実行中
  const urlHtml = state.url
    ? `<p>以下の URL を自分のブラウザで開いてログインしてください。</p>
       <div class="url-box"><a href="${escapeHtml(state.url)}" target="_blank" rel="noopener">${escapeHtml(state.url)}</a></div>`
    : `<p>認証 URL を取得中です…</p>`;

  const invalidMsg = state.status === 'invalid'
    ? `<p class="warn">コードが正しくないか、コピーが不完全なようです。もう一度貼り付けてください。</p>`
    : '';

  return page(`
    <div class="card">
      ${urlHtml}
      ${invalidMsg}
      <form method="POST" action="submit">
        <label for="code">ログイン後に表示される認証コードを貼り付けてください</label>
        <input type="text" id="code" name="code" autocomplete="off" placeholder="認証コード">
        <button type="submit">送信</button>
      </form>
      <form method="POST" action="cancel" style="margin-top:0.6rem">
        <button type="submit" style="background:#888">キャンセル</button>
      </form>
    </div>
  `, true);
}

const server = http.createServer((req, res) => {
  const path = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';

  if (req.method === 'GET' && path === '/') {
    const html = renderIndex();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (req.method === 'POST' && (path === '/start' || path === '/submit' || path === '/cancel')) {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const form = querystring.parse(body);
      if (path === '/start') startLogin();
      if (path === '/submit') submitCode(form.code);
      if (path === '/cancel') cancelLogin();
      res.writeHead(303, { Location: '.' });
      res.end();
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`login_server listening on :${PORT}`);
});
