/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useViewerStore } from '@/store';
import { windmillContext } from './context';
import { storageTransport, WindmillFiles } from './files';

export function windmillOptions() {
  const context = windmillContext();
  if (!context) return {};
  const state = useViewerStore.getState();
  const primary = context.profile === 'clash-detection' ? 'clash' : 'sources';
  state.setSidebarMode('expanded');
  state.openWorkspacePanel(primary, 'programmatic');
  return { sourceProviders: [
    () => new WindmillFiles(storageTransport(context, 'pipeline'), context, 'pipeline'),
    () => new WindmillFiles(storageTransport(context, 'storage'), context, 'storage'),
  ] };
}
