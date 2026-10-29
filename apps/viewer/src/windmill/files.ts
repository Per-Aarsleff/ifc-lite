/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type {
  DownloadOptions, FileFilter, FileSourceProvider, ListOptions, PluginContext,
  PluginManifest, SourceFileRef,
} from '@ifc-lite/plugin-api';
import type { WindmillContext } from './context';

export interface FilePage {
  folders: { prefix: string; name: string }[];
  files: { key: string; name: string; size?: number; last_modified?: string }[];
  next_page_token?: string;
  restricted_access?: boolean;
}

export type StorageTransport = (operation: 'list' | 'download', params: URLSearchParams, signal?: AbortSignal) => Promise<Response>;

/** The host supplies an authenticated transport. No resource credentials enter a provider. */
export class WindmillFiles implements FileSourceProvider {
  readonly manifest: PluginManifest;
  constructor(private readonly transport: StorageTransport, private readonly context: WindmillContext,
    kind: 'storage' | 'pipeline') {
    this.manifest = {
      name: `windmill-${kind}`, title: kind === 'storage' ? 'Windmill object storage' : 'Windmill IFC files',
      api: '^2.0.0', auth: 'preferences', preferences: [], permissions: { network: [] },
      capabilities: { containerListing: 'direct-children', listFilesIsRecursive: false,
        revisionHistory: false, downloadHistoricalRevisions: false, changeDetection: false, search: false },
      contributes: { fileSources: [] },
    };
  }
  async listProjects() {
    return { items: [{ id: this.context.workspace, name: this.context.workspace }] };
  }
  private async page(prefix: string, options?: ListOptions): Promise<FilePage> {
    const params = new URLSearchParams({ prefix, max_keys: String(Math.min(options?.limit ?? 100, 1000)) });
    if (options?.cursor) params.set('page_token', options.cursor);
    const response = await this.transport('list', params, options?.signal);
    if (!response.ok) throw new Error(`Windmill file listing failed (${response.status}): ${await response.text()}`);
    const page: FilePage = await response.json();
    if (page.restricted_access) throw new Error('Windmill restricted this storage listing. Check workspace storage permissions and edition limits.');
    if (!Array.isArray(page.folders) || !Array.isArray(page.files)) throw new Error('Windmill returned an invalid file listing');
    return page;
  }
  async listContainers(_ctx: PluginContext, _project: string, parentId?: string, options?: ListOptions) {
    if (parentId === undefined) return { items: [{ id: '/', name: 'Files', hasChildren: true }] };
    const page = await this.page(parentId === '/' ? '' : parentId, options);
    return { items: page.folders.map(folder => ({ id: folder.prefix, name: folder.name, parentId })), cursor: page.next_page_token };
  }
  async listFiles(_ctx: PluginContext, _project: string, containerId: string, _filter?: FileFilter, options?: ListOptions) {
    const page = await this.page(containerId === '/' ? '' : containerId, options);
    return { items: page.files.filter(file => /\.(ifc|ifczip|ifcx)$/i.test(file.name)).map(file => ({
      id: file.key, name: file.name, containerId, sizeBytes: file.size,
      modifiedAt: file.last_modified, currentRevisionId: `${file.last_modified ?? ''}:${file.size ?? ''}`,
    })), cursor: page.next_page_token };
  }
  async download(_ctx: PluginContext, ref: SourceFileRef, options?: DownloadOptions) {
    const response = await this.transport('download', new URLSearchParams({ file_key: ref.fileId }), options?.signal);
    if (!response.ok) throw new Error(`Windmill file download failed (${response.status}): ${await response.text()}`);
    const total = Number(response.headers.get('content-length')) || undefined;
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Windmill returned an empty download response');
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    options?.onProgress?.(0, total);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); received += value.byteLength;
        options?.onProgress?.(received, total);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes.buffer;
  }
}

export function storageTransport(context: WindmillContext, kind: 'storage' | 'pipeline'): StorageTransport {
  return async (operation, params, signal) => {
    const path = kind === 'storage'
      ? `/api/w/${encodeURIComponent(context.workspace)}/job_helpers/${operation === 'list' ? 'list_stored_files_paged' : 'download_s3_file'}`
      : `/ifc-lite/api/files/${operation}`;
    if (kind === 'pipeline') params.set('app', context.appPath);
    return fetch(new URL(`${path}?${params}`, context.origin), { credentials: 'same-origin', signal });
  };
}
