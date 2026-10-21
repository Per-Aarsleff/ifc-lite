#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at https://mozilla.org/MPL/2.0/.
"""Publish the built viewer profiles as authenticated, native Windmill apps."""
import argparse
import json
import os
from pathlib import Path
import urllib.error
import urllib.request
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default=os.getenv('WINDMILL_URL', 'http://127.0.0.1:8100'))
    parser.add_argument('--workspace', default=os.getenv('WINDMILL_WORKSPACE', 'main'))
    parser.add_argument('--credentials-file', type=Path)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    bundles = [json.loads(path.read_text()) for path in sorted(Path(__file__).parent.joinpath('dist').glob('*.json'))]
    if not bundles:
        raise SystemExit('No packaged apps. Run pnpm build:windmill first.')
    if args.dry_run:
        for bundle in bundles:
            print(bundle['app']['path'], bundle['app']['summary'], len(bundle['js']), 'bytes')
        return
    token = os.getenv('WINDMILL_TOKEN')
    base = args.url.rstrip('/') + '/api'

    def call(path, data=None, content_type='application/json'):
        headers = {'Content-Type': content_type}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        request = urllib.request.Request(base + path, data=data, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read().decode()
        except urllib.error.HTTPError as error:
            # Response bodies can include credentials; never print them.
            raise RuntimeError(f'{path}: HTTP {error.code}') from None
        try:
            return json.loads(body)
        except ValueError:
            return body

    logged_in = False
    if not token and args.credentials_file:
        credentials = json.loads(args.credentials_file.read_text())
        token = call('/auth/login', json.dumps({key: credentials[key] for key in ('email', 'password')}).encode())
        logged_in = True
    if not token:
        raise SystemExit('Set WINDMILL_TOKEN or provide --credentials-file.')
    try:
        workspace = '/w/' + urllib.parse.quote(args.workspace, safe='')
        folders = call(workspace + '/folders/list')
        if not any(folder['name'] == 'ifclite' for folder in folders):
            call(workspace + '/folders/create', json.dumps({'name': 'ifclite', 'owners': [], 'extra_perms': {}}).encode())
        for bundle in bundles:
            path = bundle['app']['path']
            exists = call(workspace + '/apps/exists/' + path)
            if exists:
                existing = call(workspace + '/apps/get/p/' + path)
                if existing.get('value', {}).get('ifclite_profile') != bundle['app']['value']['ifclite_profile']:
                    raise RuntimeError(f'Refusing to overwrite an unrelated app: {path}')
            boundary = 'ifclite-' + uuid.uuid4().hex
            chunks = []
            for key in ('app', 'js', 'css'):
                value = json.dumps(bundle[key]) if key == 'app' else bundle[key]
                chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
            chunks.append(f'--{boundary}--\r\n'.encode())
            endpoint = '/apps/update_raw/' + path if exists else '/apps/create_raw'
            call(workspace + endpoint, b''.join(chunks), 'multipart/form-data; boundary=' + boundary)
            print('Published', path)
    finally:
        if logged_in:
            call('/auth/logout', b'{}')


if __name__ == '__main__':
    main()
