/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createWindmillAssetServer } from '../integrations/windmill/server.mjs';

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test('Windmill integration: sessions and app permissions protect shared IFC files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'windmill-ifclite-'));
  const assets = join(root, 'assets'), files = join(root, 'files');
  await mkdir(assets); await mkdir(files); await mkdir(join(files, 'models'));
  const model = Buffer.from('ISO-10303-21;\nDATA;\nENDSEC;\nEND-ISO-10303-21;');
  await writeFile(join(files, 'models', 'My model.ifc'), model);
  await writeFile(join(root, 'secret.ifc'), 'not accessible');
  await symlink(join(root, 'secret.ifc'), join(files, 'escape.ifc'));
  await writeFile(join(assets, 'engine.wasm'), Buffer.from([0,97,115,109]));
  const seen = [];
  const windmill = createServer((req, res) => {
    seen.push({ url: req.url, cookie: req.headers.cookie });
    res.writeHead(req.headers.cookie === 'session=authorized' ? 200 : 403, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  const windmillUrl = await listen(windmill);
  const gateway = createWindmillAssetServer({ windmillUrl, workspace: 'main', assetRoot: assets, roots: { uploads: files } });
  const base = await listen(gateway);
  t.after(async () => {
    await Promise.all([gateway, windmill].map(server => new Promise(resolve => server.close(resolve))));
    await rm(root, { recursive: true, force: true });
  });
  const query = new URLSearchParams({ app: 'f/ifclite/discovery', prefix: 'uploads/models/' });
  const headers = { cookie: 'session=authorized' };
  assert.equal((await fetch(`${base}/ifc-lite/api/files/list?${query}`)).status, 401);
  assert.equal((await fetch(`${base}/ifc-lite/api/files/list?${query}`, { headers: { cookie: 'session=denied' } })).status, 403);
  const pageResponse = await fetch(`${base}/ifc-lite/api/files/list?${query}`, { headers });
  const page = await pageResponse.json();
  assert.equal(page.files[0].key, 'uploads/models/My model.ifc');
  assert.equal(pageResponse.headers.get('cache-control'), 'private, no-store');
  assert.equal(seen.at(-1).url, '/api/w/main/apps/get/p/f/ifclite/discovery');
  const download = new URLSearchParams({ app: 'f/ifclite/clash_detection', file_key: page.files[0].key });
  assert.deepEqual(Buffer.from(await (await fetch(`${base}/ifc-lite/api/files/download?${download}`, { headers })).arrayBuffer()), model);
  for (const key of ['uploads/../secret.ifc', 'uploads/escape.ifc']) {
    download.set('file_key', key);
    assert.ok([400,403].includes((await fetch(`${base}/ifc-lite/api/files/download?${download}`, { headers })).status));
  }
  query.set('app', 'f/elsewhere/other');
  assert.equal((await fetch(`${base}/ifc-lite/api/files/list?${query}`, { headers })).status, 403);
  assert.equal((await fetch(`${base}/ifc-lite/engine.wasm`)).headers.get('content-type'), 'application/wasm');
  assert.equal((await fetch(`${base}/ifc-lite/index.html`, { redirect: 'manual' })).status, 302);
});
