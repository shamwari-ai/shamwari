// A static file server for dist-e2e/, standing in for Workers static assets
// (directory index, correct content types, service workers allowed on /chat/).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const root = new URL('../dist-e2e/', import.meta.url).pathname;
const port = Number(process.argv[2] ?? 4322);
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
const headersFor = (p) => {
  const out = {};
  for (const r of rules) {
    const match = r.path.endsWith('*') ? p.startsWith(r.path.slice(0, -1)) : p === r.path;
    if (match) Object.assign(out, r.headers);
  }
  return out;
};

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, path);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', ...headersFor(new URL(req.url, 'http://x').pathname) });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(port, '127.0.0.1');
