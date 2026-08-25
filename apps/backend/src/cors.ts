/**
 * CORS origin policy, shared by the HTTP app and the socket.io gateway.
 *
 * - CORS_ORIGIN set: comma-separated allow-list (use '*' to reflect any origin).
 * - Unset, non-production: reflect any origin, which is what the POC has always
 *   done and what the Vite dev proxy expects.
 * - Unset, production: same-origin only. The default deployment puts the console
 *   behind a reverse proxy on one origin, so no CORS is needed; a separate
 *   console host must set CORS_ORIGIN explicitly.
 */
export function corsOrigin(): boolean | string[] {
  const configured = process.env.CORS_ORIGIN;
  if (configured) {
    if (configured.trim() === '*') return true;
    return configured
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }
  return process.env.NODE_ENV !== 'production';
}
