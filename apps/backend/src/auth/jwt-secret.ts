/**
 * Single source for the JWT signing secret.
 *
 * Both AuthModule and SessionsModule sign/verify with this — they must never
 * drift apart, and the well-known dev fallback must never reach a deployment.
 */
const DEV_FALLBACK = 'helpdesk-poc-dev-secret-change-me';

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === 'production') {
    // Falling back here would let anyone forge a technician token, since the
    // fallback is published in this repo. Fail at boot instead.
    throw new Error(
      'JWT_SECRET is required when NODE_ENV=production (refusing to start with the public dev fallback secret)',
    );
  }

  return DEV_FALLBACK;
}
