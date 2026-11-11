// A static file server for dist-e2e/, standing in for Workers static assets
// (directory index, correct content types, service workers allowed on /lite/).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const port = Number(process.argv[2] ?? 4322);
const root = new URL(`../${process.argv[3] ?? 'dist-e2e'}/`, import.meta.url).pathname;
const stubAuth = process.argv.includes('--stub-auth');
// --gate: stand in for the Worker's gate (worker/gate.ts). Everything under /lite/ except the short public list needs the
// session cookie, and a REAL BROWSER decides whether the cookie is sent (its Path is /lite/), which is the point: a gated
// file outside that path never loads.
const gated = process.argv.includes('--gate');
const PUBLIC = /^\/lite\/(disclaimer\/?|manifest\.webmanifest|sw\.js|icons\/[\w.-]+\.png|_astro\/[\w.-]+\.css)$/;

// A STAND-IN for the chat session Worker (docs/chat-signin.md), which is a design,
// not code. It speaks only the three calls the page makes and keeps its state in
// memory; the tests steer it through POST /__stub/auth and read it back with GET.
const stub = { session: false, tokens: [], tokenCalls: 0, logoutCalls: 0, tokenStatus: null, tokenDelayMs: 0, logoutDelayMs: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
};
async function stubRoute(req, res, path) {
  if (path === '/__stub/auth') {
    if (req.method === 'POST') {
      let raw = '';
      for await (const c of req) raw += c;
      Object.assign(stub, { tokenCalls: 0, logoutCalls: 0, tokenStatus: null, tokens: [], session: false, tokenDelayMs: 0, logoutDelayMs: 0 }, JSON.parse(raw || '{}'));
    }
    return json(res, 200, { tokenCalls: stub.tokenCalls, logoutCalls: stub.logoutCalls, session: stub.session });
  }
  if (path === '/lite/auth/login') {
    stub.session = true;
    res.writeHead(302, { Location: '/lite/', 'Set-Cookie': 'stub_session=1; Path=/lite/; HttpOnly; SameSite=Lax' });
    return res.end();
  }
  if (path === '/lite/auth/token') {
    stub.tokenCalls += 1;
    if (stub.tokenDelayMs) await sleep(stub.tokenDelayMs); // a slow link to the Worker
    if (stub.tokenStatus) return json(res, stub.tokenStatus, { error: 'session_ended' });
    // The session is a flag here, not a real cookie check: what is under test is the page, not the Worker.
    if (!stub.session) return json(res, 401, { error: 'no_session' });
    const token = stub.tokens.length ? stub.tokens.shift() : `eyJhbGciOiJSUzI1NiJ9.valid-${stub.tokenCalls}.sig`;
    return json(res, 200, { access_token: token, expires_at: Math.floor(Date.now() / 1000) + 300 });
  }
  if (path === '/lite/auth/logout' && req.method === 'POST') {
    stub.logoutCalls += 1;
    if (stub.logoutDelayMs) await sleep(stub.logoutDelayMs); // a request that hangs
    stub.session = false;
    res.writeHead(204, { 'Set-Cookie': 'stub_session=; Path=/lite/; Max-Age=0; HttpOnly' });
    return res.end();
  }
  return false;
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

// Honour dist-e2e/_headers the way Workers static assets does, so the CSP the
// production build sends is the CSP the e2e tests run under.
const rules = [];
try {
  let cur = null;
  for (const line of readFileSync(join(root, '_headers'), 'utf8').split('\n')) {
    if (/^\S/.test(line)) rules.push((cur = { path: line.trim(), headers: {} }));
    else if (cur && line.includes(':')) cur.headers[line.slice(0, line.indexOf(':')).trim()] = line.slice(line.indexOf(':') + 1).trim();
  }
} catch {}
// Honour dist-e2e/_redirects the way Workers static assets does (exact paths and a
// trailing /* splat), so the root 302 and the apex-to-www 301s are exercised.
const redirects = [];
try {
  for (const line of readFileSync(join(root, '_redirects'), 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [from, to, status] = t.split(/\s+/);
    redirects.push({ from, to, status: Number(status ?? 302) });
  }
} catch {}
const redirectFor = (p) => {
  for (const r of redirects) {
    if (r.from.endsWith('/*') ? p.startsWith(r.from.slice(0, -1)) : p === r.from) {
      return { status: r.status, location: r.to.replace(':splat', r.from.endsWith('/*') ? p.slice(r.from.length - 1) : '') };
    }
  }
  return null;
};
const headersFor = (p) => {
  const out = {};
  for (const r of rules) {
    const match = r.path.endsWith('*') ? p.startsWith(r.path.slice(0, -1)) : p === r.path;
    if (match) Object.assign(out, r.headers);
  }
  return out;
};

// A test hook: each GET /__sw/bump makes /lite/sw.js a different file (a comment line is added), which is exactly what a
// new release is to a browser, so a test can drive a real service worker update.
let swBump = 0;

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path === '/__sw/bump') {
    swBump += 1;
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    return res.end(String(swBump));
  }
  const redirect = redirectFor(path);
  if (redirect) {
    res.writeHead(redirect.status, { Location: redirect.location });
    return res.end();
  }
  if (stubAuth && (path.startsWith('/__stub/') || path.startsWith('/lite/auth/'))) {
    if ((await stubRoute(req, res, path)) !== false) return;
  }
  if (gated && (path.startsWith('/lite/') || path.startsWith('/_astro/')) && !PUBLIC.test(path)) {
    if (!/(^|;\s*)stub_session=1/.test(req.headers.cookie ?? '')) {
      const shell = path === '/lite/' || path === '/lite/index.html';
      res.writeHead(shell ? 302 : 401, shell ? { Location: '/lite/auth/login', 'Cache-Control': 'no-store' } : { 'Cache-Control': 'no-store' });
      return res.end();
    }
  }
  let file = join(root, path);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    let body = await readFile(file);
    if (path === '/lite/sw.js' && swBump) body = Buffer.concat([body, Buffer.from(`\n// e2e bump ${swBump}\n`)]);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', ...headersFor(new URL(req.url, 'http://x').pathname) });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(port, '127.0.0.1');
