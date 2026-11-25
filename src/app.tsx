import { useEffect, useState } from "preact/hooks";
import { lazy, Suspense } from "preact/compat";
import { appConfig, t } from "./i18n";
import { Visitor } from "./visitor/Visitor";

export function navigate(path: string) {
  history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return path;
}

export function Link(props: { href: string; children: any; class?: string; current?: "page"; title?: string }) {
  return (
    <a
      href={props.href}
      class={props.class}
      aria-current={props.current}
      title={props.title}
      onClick={(e) => {
        e.preventDefault();
        navigate(props.href);
      }}
    >
      {props.children}
    </a>
  );
}

// The admin bundle is only fetched on /admin, so visitors download as little as possible.
const AdminShell = lazy(() => import("./admin/AdminShell").then((m) => ({ default: m.AdminShell })));

export function App() {
  const path = usePath();
  if (path.startsWith("/admin")) {
    return (
      <Suspense fallback={<div class="center muted">{t("Loading…")}</div>}>
        <AdminShell path={path} />
      </Suspense>
    );
  }
  const m = path.match(/^\/v\/([0-9A-Za-z]+)\/?$/);
  if (m) return <Visitor slug={m[1]} />;
  const c = path.match(/^\/([A-Za-z0-9][A-Za-z0-9_-]{2,39})\/?$/);
  if (c) return <Visitor slug={c[1]} />;
  return <div class="center muted">{appConfig.appName}</div>;
}
