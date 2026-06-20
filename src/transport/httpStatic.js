'use strict';

/**
 * @module transport/httpStatic
 * HTTP-сервер статики: отдаёт файлы только из public/. Содержит защиту от
 * path traversal (см. CLAUDE.md §2.7). Игровой логики здесь нет.
 * Экспорт: createHttpServer.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { PUBLIC_DIR, MIME } = require('../config');

/**
 * Создаёт HTTP-сервер, раздающий статику из public/. `/` отображается на
 * index.html. Запросы за пределы public/ отклоняются с 403.
 *
 * @returns {import('http').Server} настроенный, но ещё не слушающий сервер
 */
function createHttpServer() {
  return http.createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
    // защита от выхода за пределы папки public
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
}

module.exports = { createHttpServer };
