/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readdir, realpath, stat } from 'node:fs/promises';
import { resolve, sep, basename } from 'node:path';

export function httpError(status, message) { return Object.assign(new Error(message), { status }); }

/** Resolves both sides, so symlinked files cannot escape a mounted root. */
export async function containedPath(root, relative) {
  if (relative.includes('\0') || relative.includes('\\') || relative.split('/').includes('..')) {
    throw httpError(400, 'Invalid file path');
  }
  const base = await realpath(root);
  const target = await realpath(resolve(base, relative || '.'));
  if (target !== base && !target.startsWith(base + sep)) throw httpError(403, 'File is outside the configured storage');
  return target;
}

export async function listFiles(roots, params) {
  const prefix = params.get('prefix') || '';
  if (!prefix) return { folders: Object.keys(roots).map(name => ({ prefix: `${name}/`, name })), files: [], restricted_access: false };
  const [rootId, ...parts] = prefix.split('/');
  if (!roots[rootId]) throw httpError(404, 'Unknown storage');
  const directory = await containedPath(roots[rootId], parts.join('/'));
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter(entry => !entry.isSymbolicLink() && !entry.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));
  const start = Number(params.get('page_token') || 0);
  const limit = Number(params.get('max_keys') || 100);
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw httpError(400, 'Invalid page');
  }
  const folders = [], files = [];
  for (const entry of entries.slice(start, start + limit)) {
    const key = `${prefix.replace(/\/?$/, '/')}${entry.name}`;
    if (entry.isDirectory()) folders.push({ prefix: `${key}/`, name: entry.name });
    else if (entry.isFile()) {
      const info = await stat(resolve(directory, entry.name));
      files.push({ key, name: entry.name, size: info.size, last_modified: info.mtime.toISOString() });
    }
  }
  return { folders, files, restricted_access: false,
    ...(start + limit < entries.length ? { next_page_token: String(start + limit) } : {}) };
}

export async function resolveDownload(roots, key) {
  const [rootId, ...parts] = key.split('/');
  if (!roots[rootId] || !parts.length) throw httpError(404, 'Unknown storage file');
  const path = await containedPath(roots[rootId], parts.join('/'));
  const info = await stat(path);
  if (!info.isFile()) throw httpError(404, 'Not a file');
  return { path, info, name: basename(path) };
}
