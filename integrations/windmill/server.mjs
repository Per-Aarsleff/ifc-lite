/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import profiles from './profiles.json' with { type: 'json' };
import { containedPath, httpError, listFiles, resolveDownload } from './files.mjs';

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.html': 'text/html' };

export function createWindmillAssetServer({ windmillUrl, workspace, assetRoot, roots = {}, fetchImpl = fetch }) {
  const windmill = new URL(windmillUrl);
  if (!['http:', 'https:'].includes(windmill.protocol)) throw new Error('Invalid Windmill backend URL');
  async function authorize(request, appPath) {
    if (!profiles.some(profile => profile.path === appPath)) throw httpError(403, 'Unknown application');
    const headers = {};
    if (request.headers.cookie) headers.cookie = request.headers.cookie;
    if (request.headers.authorization) headers.authorization = request.headers.authorization;
    if (!headers.cookie && !headers.authorization) throw httpError(401, 'Sign in to Windmill');
    const response = await fetchImpl(new URL(`/api/w/${encodeURIComponent(workspace)}/apps/get/p/${appPath}`, windmill),
      { headers, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw httpError(response.status === 401 ? 401 : 403, 'Windmill denied access to this application');
  }
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://internal');
      if (!['GET', 'HEAD'].includes(request.method)) throw httpError(405, 'Method not allowed');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      if (url.pathname === '/health') {
        response.writeHead(200, { 'Content-Type': 'text/plain' }); response.end('ok'); return;
      }
      if (url.pathname.startsWith('/ifc-lite/api/files/')) {
        await authorize(request, url.searchParams.get('app'));
        response.setHeader('Cache-Control', 'private, no-store');
        if (url.pathname.endsWith('/list')) {
          const page = await listFiles(roots, url.searchParams);
          response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(page)); return;
        }
        if (url.pathname.endsWith('/download')) {
          const file = await resolveDownload(roots, url.searchParams.get('file_key') || '');
          await sendFile(request, response, file.path, file.info); return;
        }
        throw httpError(404, 'Unknown file operation');
      }
      if (!url.pathname.startsWith('/ifc-lite/')) throw httpError(404, 'Not found');
      const relative = decodeURIComponent(url.pathname.slice('/ifc-lite/'.length));
      // Windmill owns the application HTML and login. This service serves only its assets.
      if (!relative || relative === 'index.html') {
        response.writeHead(302, { Location: `/apps/get/${profiles[0].path}?workspace=${encodeURIComponent(workspace)}` });
        response.end(); return;
      }
      const path = await containedPath(assetRoot, relative);
      const info = await stat(path);
      if (!info.isFile()) throw httpError(404, 'Not a file');
      response.setHeader('Cache-Control', relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      await sendFile(request, response, path, info);
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      const status = error.status || (error.code === 'ENOENT' ? 404 : 500);
      if (status === 500) console.error('[windmill assets]', error.message);
      response.writeHead(status, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      response.end(status === 500 ? 'Asset service failed' : error.message);
    }
  });
}

async function sendFile(request, response, path, info) {
  response.setHeader('Content-Type', MIME[extname(path)] || 'application/octet-stream');
  response.setHeader('Content-Length', info.size);
  response.setHeader('Last-Modified', info.mtime.toUTCString());
  if (request.method === 'HEAD') { response.end(); return; }
  await pipeline(createReadStream(path), response);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createWindmillAssetServer({
    windmillUrl: process.env.WINDMILL_INTERNAL_URL || 'http://127.0.0.1:8100',
    workspace: process.env.WINDMILL_WORKSPACE || 'main',
    assetRoot: resolve(process.env.IFCLITE_DIST || 'apps/viewer/dist'),
    roots: JSON.parse(process.env.IFCLITE_FILE_ROOTS || '{}'),
  });
  server.listen(Number(process.env.PORT || 8091), process.env.BIND_HOST || '127.0.0.1', () => console.log('Windmill IFC asset service listening'));
}
