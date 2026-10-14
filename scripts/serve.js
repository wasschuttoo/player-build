#!/usr/bin/env node
'use strict';
// Local Build Album: serves the site exactly as GitHub Pages does, plus one thing Pages can't do — any card that
// isn't in public/data/cards yet is fetched from efhub on the spot, saved to the library and returned. So every
// card you search works instantly, and the cards you used are ready to upload with the rest of the site.
//   npm start            (http://localhost:4747, or PORT=xxxx)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { fetchCard, save, readIndex, writeIndex, OUT } = require('./fetch-card.js');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 4747;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

// One efhub request at a time; concurrent asks for the same card share it.
const pending = new Map();
let queue = Promise.resolve();
function cardOnDemand(id) {
  if (pending.has(id)) return pending.get(id);
  const job = queue.then(async () => {
    const file = path.join(OUT, `${id}.json`);
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
    const card = await fetchCard(id);
    const index = readIndex();
    const entry = save(card, index);
    writeIndex(index);
    console.log(`+ ${entry.id}\t${entry.name} (${entry.type}, ${entry.position})`);
    return fs.readFileSync(file, 'utf8');
  });
  queue = job.catch(() => {});
  pending.set(id, job);
  job.finally(() => pending.delete(id)).catch(() => {});
  return job;
}

http.createServer(async (req, res) => {
  const send = (status, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  };
  let rel;
  try {
    rel = new URL(req.url, 'http://x').pathname;
    rel = decodeURIComponent(rel === '/' ? '/index.html' : rel).replace(/^\/+/, '');
  } catch { return send(400, 'Bad path'); }

  const lib = /^lib\/(efhub_builder|manager)\.js$/.exec(rel);
  if (lib) return send(200, fs.readFileSync(path.join(ROOT, `${lib[1]}.js`), 'utf8').replace(/^#!.*\r?\n/, ''), TYPES['.js']);

  const card = /^data\/cards\/(\d{6,})\.json$/.exec(rel);
  if (card && !fs.existsSync(path.join(OUT, `${card[1]}.json`))) {
    try { return send(200, await cardOnDemand(card[1]), TYPES['.json']); } catch (e) {
      console.warn(`! ${card[1]}\t${e.message}`);
      return send(e.permanent ? 404 : 502, e.message);
    }
  }

  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, 'Not found');
  send(200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
}).listen(PORT, '127.0.0.1', () => console.log(`Build Album on http://localhost:${PORT} — any card loads straight from efhub`));
