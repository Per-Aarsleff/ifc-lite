/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export interface WindmillContext {
  workspace: string;
  profile: 'discovery' | 'clash-detection';
  appPath: string;
  origin: string;
}

declare global {
  interface Window { __IFCLITE_WINDMILL__?: WindmillContext }
}

export function windmillContext(): WindmillContext | undefined {
  const context = window.__IFCLITE_WINDMILL__;
  if (!context) return undefined;
  if (!/^[\w-]+$/.test(context.workspace)
    || !['discovery', 'clash-detection'].includes(context.profile)
    || new URL(context.origin).origin !== window.location.origin) {
    throw new Error('Invalid Windmill application context');
  }
  return context;
}
