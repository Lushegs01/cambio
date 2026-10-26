import { DatabaseSync, backup } from 'node:sqlite';
import { closeSync, mkdirSync, openSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** SQLite's backup API includes committed WAL data; a plain copy of a live .sqlite file does not. */
export async function backupIdentity(source, destination) {
  if (!path.isAbsolute(source) || !path.isAbsolute(destination) || source === destination) throw new Error('Use distinct absolute source and backup paths.');
  const db = new DatabaseSync(source, { readOnly: true });
  let reserved = false;
  try {
    if (Number(db.prepare('PRAGMA application_id').get().application_id) !== 1128353090 || Number(db.prepare('PRAGMA user_version').get().user_version) !== 1) throw new Error('Source is not a supported Cambio registry.');
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    closeSync(openSync(destination, 'wx', 0o600)); reserved = true;
    await backup(db, destination);
    const check = new DatabaseSync(destination, { readOnly: true });
    try { if (check.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('Backup integrity check failed.'); }
    finally { check.close(); }
    reserved = false;
    return destination;
  } finally {
    db.close();
    // Only remove the exact output reserved by this invocation; never overwrite an existing backup.
    if (reserved) rmSync(destination, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const source = process.env.IDENTITY_DATABASE_PATH;
    const destination = process.argv[2];
    if (!source || !destination) throw new Error('Usage: IDENTITY_DATABASE_PATH=/absolute/identity.sqlite node scripts/backup-identity.mjs /absolute/backup.sqlite');
    console.log(`Backup verified: ${await backupIdentity(source, destination)}`);
  } catch (error) { console.error(error instanceof Error ? error.message : 'Backup failed'); process.exitCode = 1; }
}
