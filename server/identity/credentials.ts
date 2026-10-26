import { applicationDefault, cert, type Credential } from 'firebase-admin/app';

/** Vercel secret environment variables need no credential file in the deployment bundle. */
export function identityCredential(env: NodeJS.ProcessEnv): Credential {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) return applicationDefault();
  try {
    const account: unknown = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (!account || typeof account !== 'object') throw new Error();
    const fields = account as Record<string, unknown>;
    if (fields.type !== 'service_account' || typeof fields.project_id !== 'string' || !fields.project_id ||
        typeof fields.client_email !== 'string' || !fields.client_email || typeof fields.private_key !== 'string' || !fields.private_key) throw new Error();
    // Pass only the fields the Admin SDK needs; never log the original JSON or parser errors.
    return cert({ projectId: fields.project_id, clientEmail: fields.client_email, privateKey: fields.private_key });
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not a valid service-account credential.');
  }
}
