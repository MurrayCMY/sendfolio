import { useEffect, useRef } from "preact/hooks";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal: moves focus inside on open, keeps Tab inside, closes on Escape,
 * and returns focus to the control that opened it. While `busy`, it cannot be dismissed.
 */
export function Modal(props: {
  labelledBy: string;
  onClose: () => void;
  busy?: boolean;
  dismissOnOverlay?: boolean;
  role?: "dialog" | "alertdialog";
  class?: string;
  children: any;
}) {
  const box = useRef<HTMLDivElement>(null);
  const busyRef = useRef(!!props.busy);
  busyRef.current = !!props.busy;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>("[data-autofocus]") ?? box.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyRef.current) { e.stopPropagation(); props.onClose(); return; }
      if (e.key !== "Tab" || !box.current) return;
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const firstEl = items[0], lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <div class="overlay" onMouseDown={(e) => { if (props.dismissOnOverlay && e.target === e.currentTarget && !busyRef.current) props.onClose(); }}>
      <div ref={box} class={`card dialog ${props.class ?? ""}`} role={props.role ?? "dialog"} aria-modal="true" aria-labelledby={props.labelledBy}>
        {props.children}
      </div>
    </div>
  );
}
