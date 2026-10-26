import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('source packaging', () => {
  it('allows application source named data or backups into a fresh Git checkout', () => {
    for (const file of ['src/data/mockData.ts', 'src/data/future-fixture.ts', 'src/backups/view.ts']) {
      // --no-index matters: an already tracked file hides overly broad ignore rules.
      const result = spawnSync('git', ['check-ignore', '--no-index', file], { encoding: 'utf8' });
      expect(result.error).toBeUndefined();
      expect(result.status, `${file} must not be excluded from a fresh upload: ${result.stdout}`).toBe(1);
    }
  });

  it('still excludes persistent registry files, backups and environment secrets', () => {
    for (const file of ['data/identity.sqlite', 'data/identity.sqlite-wal', 'backups/identity.sqlite', '.env.selfhost.local']) {
      const result = spawnSync('git', ['check-ignore', '--no-index', file], { encoding: 'utf8' });
      expect(result.error).toBeUndefined();
      expect(result.status, `${file} must stay private`).toBe(0);
    }
  });
});
