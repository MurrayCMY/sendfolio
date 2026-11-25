/** What a request handler needs to know about the request beyond the Request itself. */
export interface Ctx {
  /** Client IP as seen by the platform (Netlify) or derived from proxy headers (self-hosted, TRUST_PROXY=true). */
  ip?: string;
  /** Optional geo hint (Netlify provides it; behind Cloudflare it is derived from CF-IPCountry). */
  geo?: { city?: string; country?: { name?: string } };
  /** Keep the process alive until the promise settles (background work after the response is sent). */
  waitUntil(p: Promise<unknown>): void;
}
