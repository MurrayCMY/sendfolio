import { useEffect, useRef } from "preact/hooks";

const BEAT_MS = 5000;
const IDLE_MS = 30000;
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "touchmove", "scroll", "wheel", "click"];

/**
 * Reading-time tracking. A beat is sent every 5 s with the page on screen and `active`, which is true only if
 * the tab is visible, the window is focused (not required on touch devices) and there was input in the last
 * 30 s. `ms` is the client-measured time the beat covers, so time spent in the background never counts.
 * The last segment is flushed with sendBeacon when the tab is hidden or closed, and on every page change.
 */
export function useTracking(slug: string, visitId: string | undefined, page: number, onGone: () => void) {
  const pageRef = useRef(page);
  const sendRef = useRef<((p: number, active: boolean, beacon: boolean) => void) | null>(null);
  const activeRef = useRef<() => boolean>(() => false);

  useEffect(() => {
    if (!visitId) return;
    const url = `/api/v/${slug}/heartbeat`;
    let lastActivity = Date.now();
    let lastTick = Date.now();
    const touch = () => { lastActivity = Date.now(); };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, touch, { passive: true, capture: true }));

    const touchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    const focused = () => {
      if (touchDevice) return true;
      try { return document.hasFocus(); } catch { return true; }
    };
    const recentInput = () => Date.now() - lastActivity < IDLE_MS;
    const activeNow = () => document.visibilityState === "visible" && focused() && recentInput();
    activeRef.current = activeNow;

    const send = (p: number, active: boolean, beacon: boolean) => {
      const now = Date.now();
      const ms = Math.min(BEAT_MS, Math.max(0, now - lastTick));
      lastTick = now;
      const body = JSON.stringify({ visit_id: visitId, page: p, active, ms });
      if (beacon && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
        return;
      }
      fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true, credentials: "same-origin" })
        .then((r) => { if (r.status === 404) onGone(); })
        .catch(() => { /* a missed beat only loses a few seconds */ });
    };
    sendRef.current = send;

    send(pageRef.current, false, false); // registers the first page view straight away
    const timer = setInterval(() => send(pageRef.current, activeNow(), false), BEAT_MS);

    const onVisibility = () => {
      if (document.visibilityState === "hidden") send(pageRef.current, recentInput(), true);
      else lastTick = Date.now(); // time in the background is never counted
    };
    const onHide = () => send(pageRef.current, document.visibilityState === "visible" && recentInput(), true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);

    return () => {
      clearInterval(timer);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, touch, { capture: true }));
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      sendRef.current = null;
    };
  }, [slug, visitId]);

  // On a page change, credit the time since the last beat to the page that was just left.
  useEffect(() => {
    if (pageRef.current !== page) {
      sendRef.current?.(pageRef.current, activeRef.current(), false);
      pageRef.current = page;
    }
  }, [page]);
}
