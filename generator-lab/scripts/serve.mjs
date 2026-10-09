// Server statico locale per il "Debug locale" di Atomm (accetta solo indirizzi di loopback).
// Uso: npm run serve -- label-generator   →  http://127.0.0.1:5173
//      npm run serve                        →  suite completa (dist/)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const slug = process.argv[2];
const dir = slug ? join(root, 'atomm-release', slug) : join(root, 'dist');
const index = slug ? `${slug}.html` : 'index.html';
const port = Number(process.env.PORT ?? 5173);
const types = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8' };

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const rel = url.pathname === '/' ? index : normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (rel.includes('..')) return void res.writeHead(400).end();
  try {
    const body = await readFile(join(dir, rel));
    res.writeHead(200, { 'Content-Type': types[extname(rel)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('Non trovato');
  }
}).listen(port, '127.0.0.1', () => console.log(`Anteprima su http://127.0.0.1:${port}  (${slug ?? 'suite completa'})`));
