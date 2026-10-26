/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Chooses and initialises the identity store from environment variables.
 *
 *   IDENTITY_STORE=firestore   Cloud Firestore via firebase-admin (default in production).
 *   IDENTITY_STORE=sqlite      Self-hosted Node >=24; IDENTITY_DATABASE_PATH must be an absolute
 *                              file path on persistent local storage. No Firebase credentials.
 *   IDENTITY_STORE=memory      In-process, non-durable. Default in development when no Firestore
 *                              credentials/emulator are configured. Refused in production unless
 *                              ALLOW_NON_DURABLE_IDENTITY=true.
 *
 * Firestore settings: FIREBASE_PROJECT_ID / FIRESTORE_DATABASE_ID (defaults come from
 * firebase-applet-config.json). Credentials come from Application Default Credentials
 * (the Cloud Run service account), GOOGLE_APPLICATION_CREDENTIALS, or the server-only
 * FIREBASE_SERVICE_ACCOUNT_JSON secret on hosts such as Vercel; FIRESTORE_EMULATOR_HOST
 * points the Admin SDK at the local emulator.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { IdentityService } from './identity/service.js';
import { MemoryIdentityStore } from './identity/memoryStore.js';
import type { IdentityStore } from './identity/store.js';
import type { SharedRateLimitStore } from './rateLimit.js';

export interface IdentityBootstrap {
  identity: IdentityService | null;
  error?: string;
  store?: IdentityStore['kind'];
  rateLimitStore?: SharedRateLimitStore;
  close?: () => void;
}

function appletConfig(): { projectId?: string; firestoreDatabaseId?: string } {
  try {
    return JSON.parse(readFileSync(path.resolve(process.cwd(), 'firebase-applet-config.json'), 'utf-8'));
  } catch {
    return {};
  }
}

export async function createFirestoreStore(env: NodeJS.ProcessEnv) {
  const { initializeApp, getApps } = await import('firebase-admin/app');
  const { identityCredential } = await import('./identity/credentials.js');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { FirestoreIdentityStore } = await import('./identity/firestoreStore.js');
  const cfg = appletConfig();
  const projectId = env.FIREBASE_PROJECT_ID || cfg.projectId;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is not set');
  // Fail fast and cleanly when no credentials exist (the emulator needs none). Without this probe the
  // Firestore client discovers the problem later, inside a promise it does not surface to callers.
  const credential = env.FIRESTORE_EMULATOR_HOST ? undefined : identityCredential(env);
  if (credential) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        credential.getAccessToken(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out obtaining Google credentials')), 8000); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  const app = getApps().find((a) => a.name === 'cambio-identity') ?? initializeApp({ projectId, credential }, 'cambio-identity');
  const databaseId = env.FIRESTORE_DATABASE_ID || cfg.firestoreDatabaseId;
  const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
  return new FirestoreIdentityStore(db, !env.FIRESTORE_EMULATOR_HOST);
}

export async function bootstrapIdentity(env: NodeJS.ProcessEnv = process.env, mode: 'production' | 'development' = 'production'): Promise<IdentityBootstrap> {
  const hasFirestore = !!(env.FIRESTORE_EMULATOR_HOST || env.GOOGLE_APPLICATION_CREDENTIALS || env.FIREBASE_SERVICE_ACCOUNT_JSON || env.K_SERVICE);
  const requested = env.IDENTITY_STORE || (mode === 'production' || hasFirestore ? 'firestore' : 'memory');
  if (requested === 'firestore' && mode === 'production' && env.FIRESTORE_EMULATOR_HOST && env.ALLOW_NON_DURABLE_IDENTITY !== 'true') return { identity: null, error: 'Firestore emulator is not durable production identity storage.' };

  if (requested === 'sqlite') {
    if (env.VERCEL || env.K_SERVICE) return { identity: null, error: 'SQLite identity requires a persistent local disk on a self-hosted server, not serverless storage.' };
    if (!env.IDENTITY_DATABASE_PATH) return { identity: null, error: 'IDENTITY_DATABASE_PATH is required for SQLite identity.' };
    if (Number(process.versions.node.split('.')[0]) < 24) return { identity: null, error: 'SQLite identity requires Node.js 24 or later.' };
    try {
      const { SqliteIdentityStore } = await import('./identity/sqliteStore.js');
      const store = new SqliteIdentityStore(env.IDENTITY_DATABASE_PATH);
      await store.ping();
      return { identity: new IdentityService({ store }), store: 'sqlite', rateLimitStore: store, close: () => store.close() };
    } catch {
      console.error('[identity] SQLite initialization failed; check the database path, permissions and schema version.');
      return { identity: null, error: 'SQLite identity store could not be initialised.' };
    }
  }

  if (requested === 'memory') {
    if (mode === 'production' && env.ALLOW_NON_DURABLE_IDENTITY !== 'true') {
      return { identity: null, error: 'IDENTITY_STORE=memory is not allowed in production (set ALLOW_NON_DURABLE_IDENTITY=true to override).' };
    }
    console.warn('[identity] Using the in-memory store: usernames are NOT durable and NOT shared across instances.');
    return { identity: new IdentityService({ store: new MemoryIdentityStore() }), store: 'memory' };
  }

  if (requested !== 'firestore') return { identity: null, error: `Unknown IDENTITY_STORE "${requested}"` };

  try {
    const store = await createFirestoreStore(env);
    return { identity: new IdentityService({ store }), store: 'firestore', rateLimitStore: store };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[identity] Firestore store could not be initialised:', message);
    return { identity: null, error: 'Firestore identity store could not be initialised.' };
  }
}
