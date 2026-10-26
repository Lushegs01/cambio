import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ applicationDefault: vi.fn(), cert: vi.fn() }));
vi.mock('firebase-admin/app', () => mocks);
import { identityCredential } from '../server/identity/credentials';

beforeEach(() => vi.resetAllMocks());
describe('server-only Firebase credentials', () => {
  it('preserves Application Default Credentials on Google Cloud and local credential files', () => {
    const credential = { getAccessToken: vi.fn() };
    mocks.applicationDefault.mockReturnValue(credential);
    expect(identityCredential({})).toBe(credential); expect(mocks.cert).not.toHaveBeenCalled();
  });
  it('uses the same explicit credential for hosts without a credential filesystem', () => {
    const credential = { getAccessToken: vi.fn() }; mocks.cert.mockReturnValue(credential);
    const json = JSON.stringify({ type: 'service_account', project_id: 'test-project', client_email: 'test@example.com', private_key: 'test-placeholder', unused: 'ignored' });
    expect(identityCredential({ FIREBASE_SERVICE_ACCOUNT_JSON: json })).toBe(credential);
    expect(mocks.cert).toHaveBeenCalledExactlyOnceWith({ projectId: 'test-project', clientEmail: 'test@example.com', privateKey: 'test-placeholder' });
    expect(mocks.applicationDefault).not.toHaveBeenCalled();
  });
  it('rejects malformed, incomplete and invalid credentials without echoing their content', () => {
    mocks.cert.mockImplementation(() => { throw new Error('private-test-value'); });
    for (const value of ['private-test-value', 'null', '{}', JSON.stringify({ type: 'service_account', project_id: 'test', client_email: 'test@example.com', private_key: 'private-test-value' })]) {
      expect(() => identityCredential({ FIREBASE_SERVICE_ACCOUNT_JSON: value })).toThrow('FIREBASE_SERVICE_ACCOUNT_JSON is not a valid service-account credential.');
    }
    expect(mocks.applicationDefault).not.toHaveBeenCalled();
  });
});
