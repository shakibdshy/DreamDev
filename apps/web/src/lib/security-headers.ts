/**
 * Security response headers applied to every route (wired through nitro
 * routeRules in vite.config.ts — pure data here so tests pin the policy).
 *
 * The CSP is a pragmatic allow-list: `script-src` keeps `'unsafe-inline'`
 * because TanStack Start's SSR hydration scripts are request-dynamic and the
 * pinned Start version exposes no per-request nonce API. Everything else is
 * locked: no foreign script origins at all, no iframing (frame-ancestors —
 * the clickjacking defence), no plugins, no base hijack, no cross-origin
 * form targets, images restricted to self and the member-photo blob host.
 */
const MEMBER_PHOTO_BLOB_HOST = "https://*.blob.vercel-storage.com";

export const securityHeaders: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${MEMBER_PHOTO_BLOB_HOST}`,
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; "),
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "X-Content-Type-Options": "nosniff",
};
