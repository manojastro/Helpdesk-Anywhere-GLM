/**
 * Deployment configuration for the technician console.
 *
 * Two supported deployments (see README):
 *
 * 1. Same-origin reverse proxy (default, and what `npm run dev:web` does):
 *    leave VITE_API_BASE unset. REST goes to /api and socket.io to the page's
 *    own origin, so a proxy must route both to the backend.
 *
 * 2. Separate backend host: build with
 *    VITE_API_BASE=https://backend.example.com
 *    REST and socket.io both target that origin, which requires the backend's
 *    CORS_ORIGIN to allow the console's origin.
 */
export const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

/**
 * Origin for the socket.io client, or '' for the page's own origin.
 * socket.io needs an origin, not the REST path prefix, so an absolute
 * API_BASE is reduced to its origin and a relative one yields same-origin.
 */
export const SOCKET_ORIGIN = ((): string => {
  if (/^https?:\/\//i.test(API_BASE)) return new URL(API_BASE).origin;
  return '';
})();
