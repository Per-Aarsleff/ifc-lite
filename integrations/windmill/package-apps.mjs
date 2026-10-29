/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import profiles from './profiles.json' with { type: 'json' };

const dist = resolve('apps/viewer/dist');
const manifest = JSON.parse(await readFile(`${dist}/.vite/manifest.json`, 'utf8'));
const entry = manifest['index.html'];
if (!entry?.file) throw new Error('Build the viewer with IFCLITE_ASSET_BASE=/ifc-lite/ first');
const css = new Set();
const visited = new Set();
function styles(chunk) {
  if (!chunk || visited.has(chunk.file)) return;
  visited.add(chunk.file);
  for (const file of chunk.css || []) css.add(file);
  for (const key of chunk.imports || []) styles(manifest[key]);
}
styles(entry);
await mkdir('integrations/windmill/dist', { recursive: true });
for (const profile of profiles) {
  const js = `
(async () => {
  const context = window.ctx;
  if (!context?.workspace || !context?.ctx?.email) throw new Error('Open this application from an authenticated Windmill workspace');
  window.__IFCLITE_WINDMILL__ = { workspace: context.workspace, profile: ${JSON.stringify(profile.id)}, appPath: ${JSON.stringify(profile.path)}, origin: location.origin };
  const storage = window.localStorage;
  const prefix = 'ifclite:windmill:' + encodeURIComponent(context.workspace) + ':' + encodeURIComponent(context.ctx.email) + ':' + ${JSON.stringify(profile.id + ':')} ;
  const keys = () => Array.from({length: storage.length}, (_, i) => storage.key(i)).filter(k => k?.startsWith(prefix));
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: k => storage.getItem(prefix + k), setItem: (k,v) => storage.setItem(prefix + k,String(v)),
    removeItem: k => storage.removeItem(prefix + k), clear: () => keys().forEach(k => storage.removeItem(k)),
    key: i => keys()[i]?.slice(prefix.length) ?? null, get length() { return keys().length; }
  }});
  for (const href of ${JSON.stringify([...css].map(file => `/ifc-lite/${file}`))}) {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href; document.head.append(link);
  }
  document.title = ${JSON.stringify(profile.summary)};
  await import(${JSON.stringify('/ifc-lite/' + entry.file)});
})().catch(error => { console.error(error); document.getElementById('root').textContent = 'IFC application could not start: ' + error.message; });
`;
  const app = { path: profile.path, summary: profile.summary,
    value: { files: { '/index.js': js }, runnables: {}, ifclite_profile: profile.id },
    policy: { execution_mode: 'viewer', sandbox: false, triggerables: {} },
    deployment_message: 'Full IFC-Lite viewer integrated into Windmill' };
  await writeFile(`integrations/windmill/dist/${profile.id}.json`, JSON.stringify({ app, js, css: 'html,body,#root{width:100%;height:100%;margin:0;overflow:hidden}' }, null, 2));
}
console.log(`Packaged ${profiles.length} native Windmill apps using ${entry.file}`);
