import { useEffect, useState } from "preact/hooks";
import "./admin.css";
import { api } from "../api";
import { Link, navigate } from "../app";
import { appConfig, t, useLang } from "../i18n";
import { LangSwitch } from "../ui/LangSwitch";
import { Logo } from "../ui/Logo";
import { IconFile, IconHome, IconLink, IconLogout, IconSettings, IconUsers } from "../ui/icons";
import { ToastHost } from "../ui/kit";
import { Login } from "../pages/Login";
import { Overview } from "../pages/Overview";
import { Documents } from "../pages/Documents";
import { DocumentDetail } from "../pages/DocumentDetail";
import { AllLinks } from "../pages/AllLinks";
import { RoomDetail, Rooms } from "../pages/Rooms";
import { Settings } from "../pages/Settings";
import { LinkDetail } from "../pages/LinkDetail";
import { VisitDetail } from "../pages/VisitDetail";
import { VisitorDetail, Visitors } from "../pages/Visitors";

type Section = "home" | "docs" | "rooms" | "links" | "visitors" | "settings";
function sectionOf(path: string): { key: Section; title: string } {
  if (path.startsWith("/admin/settings")) return { key: "settings", title: t("Settings") };
  if (path.startsWith("/admin/visitors")) return { key: "visitors", title: t("Visitors") };
  if (path.startsWith("/admin/rooms")) return { key: "rooms", title: t("Data rooms") };
  if (path.startsWith("/admin/links")) return { key: "links", title: t("Links") };
  if (path.startsWith("/admin/visits")) return { key: "docs", title: t("Visit details") };
  if (path.startsWith("/admin/documents")) return { key: "docs", title: path === "/admin/documents" ? t("Documents") : t("Document details") };
  return { key: "home", title: t("Overview") };
}

export function AdminShell({ path }: { path: string }) {
  const [state, setState] = useState<"loading" | "in" | "out">("loading");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api.me().then((r) => setState(r.admin ? "in" : "out")).catch(() => setState("out"));
  }, []);

  // Any admin API call answered with 401 means the 14-day session ended: go back to the login page.
  useEffect(() => {
    const on = () => { setNotice(t("Your session has expired. Please sign in again.")); setState("out"); };
    window.addEventListener("admin-unauthorized", on);
    return () => window.removeEventListener("admin-unauthorized", on);
  }, []);

  const [lang] = useLang(); // re-render (and remount the page below) when the language changes
  const section = sectionOf(path);
  useEffect(() => {
    document.title = state === "out" ? `${t("Admin sign-in")} · ${appConfig.appName}` : `${section.title} · ${appConfig.appName}`;
  }, [path, state]);

  if (state === "loading") return <div class="admin admin-solo"><div class="center muted" role="status">{t("Loading…")}</div></div>;
  if (state === "out") return <Login notice={notice} onDone={() => { setNotice(""); setState("in"); navigate("/admin"); }} />;

  const idOf = (re: RegExp) => path.match(re)?.[1];
  const detail = path.match(/^\/admin\/documents\/([0-9a-f-]{36})\/?$/i);
  const roomId = idOf(/^\/admin\/rooms\/([0-9a-f-]{36})\/?$/i);
  const linkId = idOf(/^\/admin\/links\/([0-9a-f-]{36})\/?$/i);
  const visitId = idOf(/^\/admin\/visits\/([0-9a-f-]{36})\/?$/i);
  const visitorId = idOf(/^\/admin\/visitors\/([0-9a-f-]{36})\/?$/i);
  const cur = (k: Section) => (section.key === k ? "page" : undefined);

  return (
    <div class="admin">
      <aside class="side">
        <Link href="/admin" class="side-brand">
          <span class="mark" aria-hidden="true"><Logo size={20} /></span>
          <span><b>{appConfig.appName}</b><small>{t("Document admin")}</small></span>
        </Link>
        <nav aria-label={t("Main navigation")}>
          <Link href="/admin" class="nav-item" current={cur("home")}><IconHome />{" "}{t("Overview")}</Link>
          <Link href="/admin/documents" class="nav-item" current={cur("docs")}><IconFile />{" "}{t("Documents")}</Link>
          <Link href="/admin/rooms" class="nav-item" current={cur("rooms")}><IconFile />{" "}{t("Data rooms")}</Link>
          <Link href="/admin/links" class="nav-item" current={cur("links")}><IconLink />{" "}{t("Links")}</Link>
          <Link href="/admin/visitors" class="nav-item" current={cur("visitors")}><IconUsers />{" "}{t("Visitors")}</Link>
          <Link href="/admin/settings" class="nav-item" current={cur("settings")}><IconSettings />{" "}{t("Settings")}</Link>
        </nav>
        <div class="side-foot">
          <LangSwitch />
          <span class="who">{t("Administrator")}</span>
          <button onClick={async () => { await api.logout(); setNotice(""); setState("out"); }}><IconLogout size={16} />{" "}{t("Sign out")}</button>
        </div>
      </aside>
      <main class="main">
        <div class="main-inner" key={lang}>
          {detail ? <DocumentDetail id={detail[1]} />
            : roomId ? <RoomDetail id={roomId} />
            : path.startsWith("/admin/rooms") ? <Rooms />
            : linkId ? <LinkDetail id={linkId} />
            : path.startsWith("/admin/links") ? <AllLinks />
            : visitId ? <VisitDetail id={visitId} />
            : visitorId ? <VisitorDetail id={visitorId} />
            : path.startsWith("/admin/visitors") ? <Visitors />
            : path.startsWith("/admin/settings") ? <Settings />
            : path.startsWith("/admin/documents") ? <Documents />
            : <Overview />}
        </div>
      </main>
      <ToastHost />
    </div>
  );
}
