import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { resolvePath, sessionFor } from './agent/tools/workspace.js';

/**
 * Serves a conversation's work dir under /api/preview/<key>/ so multi-file prototypes (pages linking shared
 * CSS/JS and each other by relative path) work inside the preview iframe. Iframes cannot send auth headers,
 * so the unguessable key in the path is the capability; keys live in memory and are re-issued after a restart.
 */
const keyBySandbox = new Map<string, string>();
const sandboxByKey = new Map<string, string>();

export function previewKey(sandboxId: string) {
  let key = keyBySandbox.get(sandboxId);
  if (!key) {
    key = crypto.randomBytes(16).toString('hex');
    keyBySandbox.set(sandboxId, key);
    sandboxByKey.set(key, sandboxId);
  }
  return key;
}

export function forgetPreview(sandboxId: string) {
  const key = keyBySandbox.get(sandboxId);
  if (!key) return;
  keyBySandbox.delete(sandboxId);
  sandboxByKey.delete(key);
}

export function servePreview(req: Request, res: Response, next: NextFunction) {
  (async () => {
    const sandboxId = sandboxByKey.get(req.params.key);
    const rel = String(req.params[0] ?? '');
    if (!sandboxId || rel.split('/').some((seg) => seg.startsWith('.'))) return res.status(404).end();
    let abs: string;
    try {
      ({ abs } = await resolvePath(rel, sessionFor(sandboxId)));
      if ((await fsp.stat(abs)).isDirectory()) abs = path.join(abs, 'index.html');
      await fsp.access(abs);
    } catch {
      return res.status(404).end();
    }
    // Generated code runs in an opaque origin even when opened directly, so it can never reach the app's storage.
    res.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-forms allow-modals allow-popups');
    // Opaque-origin pages need CORS for module scripts and fetch() of their own files.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(abs);
  })().catch(next);
}
