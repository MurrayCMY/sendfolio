import { useEffect, useId, useRef, useState } from "preact/hooks";
import { IconCheck, IconMore } from "./icons";
import { t } from "../i18n";

/* ---------- Badge ---------- */
export type Tone = "ok" | "muted" | "warn" | "bad" | "info";
export function Badge({ tone = "muted", children, icon }: { tone?: Tone; children: any; icon?: any }) {
  return <span class={`badge badge-${tone} ${icon ? "has-icon" : ""}`}>{icon}{children}</span>;
}

/* ---------- Avatar (initials, colour from the name) ---------- */
const HUES = [152, 172, 196, 28, 340, 262, 90, 12];
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const s = name.trim();
  const initials = /[一-龥]/.test(s) ? s.slice(-2) : s.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = HUES[h % HUES.length];
  return (
    <span class="avatar" style={{ width: size, height: size, background: `hsl(${hue} 32% 90%)`, color: `hsl(${hue} 40% 26%)`, fontSize: size * 0.38 }} aria-hidden="true">
      {initials || "?"}
    </span>
  );
}

/* ---------- Tabs ---------- */
export function Tabs<T extends string>(props: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (id: T) => void; label: string }) {
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = props.tabs[(i + d + props.tabs.length) % props.tabs.length];
    props.onChange(next.id);
    (e.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>("[role=tab]")[props.tabs.indexOf(next)]?.focus();
  };
  return (
    <div class="tabs" role="tablist" aria-label={props.label}>
      {props.tabs.map((t, i) => (
        <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={props.value === t.id} aria-controls={`panel-${t.id}`}
          tabIndex={props.value === t.id ? 0 : -1} class={`tab ${props.value === t.id ? "on" : ""}`}
          onClick={() => props.onChange(t.id)} onKeyDown={(e) => onKey(e, i)}>
          {t.label}{t.count !== undefined && <span class="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- Menu (kebab) ---------- */
export interface MenuItem { label: string; icon?: any; onClick: () => void; danger?: boolean; disabled?: boolean; divider?: boolean }
export function Menu({ items, label = t("More actions") }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    pop.current?.querySelector<HTMLElement>("[role=menuitem]:not([disabled])")?.focus();
    const close = () => setOpen(null);
    const onDown = (e: MouseEvent) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { close(); btn.current?.focus(); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const els = [...(pop.current?.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])") ?? [])];
        const i = els.indexOf(document.activeElement as HTMLElement);
        els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length]?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button ref={btn} class="icon-btn" aria-haspopup="menu" aria-expanded={!!open} aria-label={label}
        onClick={() => {
          if (open) return setOpen(null);
          const r = btn.current!.getBoundingClientRect();
          const w = 200;
          setOpen({ x: Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8), y: r.bottom + 4 });
        }}>
        <IconMore />
      </button>
      {open && (
        <div ref={pop} class="menu" role="menu" style={{ left: open.x, top: open.y }}>
          {items.map((it, i) => it.divider ? <div key={i} class="menu-sep" role="separator" /> : (
            <button key={i} role="menuitem" class={`menu-item ${it.danger ? "menu-danger" : ""}`} disabled={it.disabled}
              onClick={() => { setOpen(null); it.onClick(); }}>
              {it.icon}<span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------- Toast ---------- */
interface ToastMsg { id: number; text: string; tone: "ok" | "bad" }
let toasts: ToastMsg[] = [];
let nextId = 1;
const listeners = new Set<(t: ToastMsg[]) => void>();
const emit = () => listeners.forEach((l) => l(toasts));
export function toast(text: string, tone: "ok" | "bad" = "ok") {
  const t = { id: nextId++, text, tone };
  toasts = [...toasts, t].slice(-3);
  emit();
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== t.id); emit(); }, tone === "bad" ? 6000 : 3200);
}
export function ToastHost() {
  const [list, setList] = useState<ToastMsg[]>(toasts);
  useEffect(() => { listeners.add(setList); return () => { listeners.delete(setList); }; }, []);
  return (
    <div class="toasts" role="status" aria-live="polite">
      {list.map((t) => <div key={t.id} class={`toast-item toast-${t.tone}`}>{t.tone === "ok" && <IconCheck size={16} />}{t.text}</div>)}
    </div>
  );
}

/* ---------- Layout bits ---------- */
export function PageHeader(props: { title: any; subtitle?: any; actions?: any; back?: any; meta?: any }) {
  return (
    <header class="page-head">
      {props.back && <div class="page-back">{props.back}</div>}
      <div class="page-head-row">
        <div class="page-titles">
          <h1>{props.title}</h1>
          {props.subtitle && <p class="page-sub">{props.subtitle}</p>}
          {props.meta && <div class="page-meta">{props.meta}</div>}
        </div>
        {props.actions && <div class="page-actions">{props.actions}</div>}
      </div>
    </header>
  );
}

export function Card(props: { title?: any; icon?: any; action?: any; children: any; pad?: boolean; class?: string }) {
  return (
    <section class={`panel ${props.class ?? ""}`}>
      {(props.title || props.action) && (
        <div class="panel-head"><h2>{props.icon}{props.title}</h2>{props.action && <div class="panel-action">{props.action}</div>}</div>
      )}
      <div class={props.pad === false ? "" : "panel-body"}>{props.children}</div>
    </section>
  );
}

export function StatCard(props: { label: string; value: any; delta?: number | null; hint?: string; icon?: any; children?: any }) {
  const d = props.delta;
  return (
    <div class="stat">
      <div class="stat-label">{props.icon && <span class="stat-icon">{props.icon}</span>}{props.label}</div>
      <div class="stat-value">{props.value}</div>
      <div class="stat-foot">
        {d !== undefined && d !== null && <span class={`delta ${d > 0 ? "up" : d < 0 ? "down" : ""}`}>{d > 0 ? "▲" : d < 0 ? "▼" : "–"} {Math.abs(Math.round(d * 100))}%</span>}
        {props.hint && <span class="muted">{props.hint}</span>}
      </div>
      {props.children}
    </div>
  );
}

export function EmptyState(props: { icon?: any; title: string; body?: string; action?: any }) {
  return (
    <div class="empty">
      {props.icon && <div class="empty-icon">{props.icon}</div>}
      <h3>{props.title}</h3>
      {props.body && <p class="muted">{props.body}</p>}
      {props.action}
    </div>
  );
}

/* ---------- Forms ---------- */
export function Field(props: { label: string; hint?: any; error?: string; required?: boolean; children: (id: string, describedBy?: string) => any }) {
  const id = useId();
  const hintId = props.hint || props.error ? `${id}-d` : undefined;
  return (
    <div class="field">
      <label for={id}>{props.label}{props.required && <span class="req" aria-hidden="true"> *</span>}</label>
      {props.children(id, hintId)}
      {props.error ? <p id={hintId} class="field-error" role="alert">{props.error}</p> : props.hint ? <p id={hintId} class="field-hint">{props.hint}</p> : null}
    </div>
  );
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label class={`switch-row ${props.disabled ? "is-disabled" : ""}`}>
      <span class="switch-text"><span class="switch-label">{props.label}</span>{props.hint && <span class="switch-hint">{props.hint}</span>}</span>
      <input type="checkbox" role="switch" class="switch" checked={props.checked && !props.disabled} disabled={props.disabled}
        onChange={(e) => props.onChange(e.currentTarget.checked)} />
    </label>
  );
}

/* ---------- Sparkline bars ---------- */
export function Spark({ data, height = 44, label }: { data: number[]; height?: number; label: string }) {
  const max = Math.max(1, ...data);
  const w = 100 / data.length;
  return (
    <svg class="spark" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" role="img" aria-label={label} style={{ height }}>
      {data.map((v, i) => {
        const h = Math.max(v ? 3 : 1.5, (v / max) * (height - 4));
        return <rect key={i} x={i * w + w * 0.18} y={height - h} width={w * 0.64} height={h} rx="1.5" class={i === data.length - 1 ? "spark-last" : v ? "spark-bar" : "spark-zero"} />;
      })}
    </svg>
  );
}
