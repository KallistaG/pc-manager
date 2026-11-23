import { INPUT, SURFACE, THEAD, pill } from "../components/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminNotice, ElevateButton } from "../components/Elevation";
import Button from "../components/Button";
import { Notice } from "../components/Card";
import { IconChevron, IconRefresh } from "../components/Icons";
import PageShell from "../components/PageShell";
import PublisherCell from "../components/PublisherCell";
import { useWindowVisible } from "../hooks/useWindowVisible";
import { api, errorMessage, isApiError, type StartupEntry, type StartupSource } from "../lib/api";
import { publisherText } from "../lib/processTable";

const SOURCE_LABEL: Record<StartupSource, string> = {
  runUser: "Registry · current user",
  runUser32: "32-bit registry · current user",
  runMachine: "Registry · system-wide",
  runMachine32: "32-bit registry · system-wide",
  runOnceUser: "RunOnce · current user",
  runOnceMachine: "RunOnce · system-wide",
  runOnceMachine32: "32-bit RunOnce · system-wide",
  startupFolderUser: "Startup folder · current user",
  startupFolderCommon: "Startup folder · all users",
  scheduledTask: "Scheduled task",
  service: "Service",
  packagedTask: "Microsoft Store app (view only)",
};

type Tab = "apps" | "tasks" | "services";
const TAB_OF = (s: StartupSource): Tab => (s === "scheduledTask" ? "tasks" : s === "service" ? "services" : "apps");
const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "apps", label: "Apps", hint: "Like Task Manager’s Startup tab — can be enabled or disabled" },
  { id: "tasks", label: "Tasks at sign-in", hint: "Scheduled tasks triggered At log on — view only" },
  { id: "services", label: "Auto-start services", hint: "Services with Start = Automatic — view only" },
];

const isMicrosoft = (e: StartupEntry) =>
  e.publisher.status === "signed" && e.publisher.name.toLowerCase().startsWith("microsoft");

function Toggle({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
      className={`relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 ${on ? "bg-accent hover:bg-blue-700" : "bg-black/20 hover:bg-black/30 dark:bg-white/20 dark:hover:bg-white/30"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

export default function Startup() {
  const [entries, setEntries] = useState<StartupEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string; needsAdmin?: boolean } | null>(null);
  const [tab, setTab] = useState<Tab>("apps");
  const [hideMs, setHideMs] = useState(true);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const visible = useWindowVisible();
  const polls = useRef(0);

  const load = useCallback(() => {
    api
      .startupList()
      .then((l) => {
        setEntries(l);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  useEffect(load, [load]);

  const [reloading, setReloading] = useState(false);
  const reload = () => {
    setReloading(true);
    polls.current = 0;
    api
      .startupList()
      .then((l) => {
        setEntries(l);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setReloading(false));
  };

  // Publisher được kiểm tra nền: tải lại vài lần cho tới khi hết "Đang kiểm tra…".
  const pending = entries?.some((e) => e.publisher.status === "pending") ?? false;
  useEffect(() => {
    if (!pending || !visible || polls.current > 20) return;
    const id = window.setTimeout(() => {
      polls.current += 1;
      load();
    }, 1500);
    return () => window.clearTimeout(id);
  }, [pending, visible, entries, load]);

  const toggle = async (e: StartupEntry, enabled: boolean) => {
    setBusy(e.id);
    setMsg(null);
    try {
      await api.startupSetEnabled(e, enabled);
      setMsg({ tone: "ok", text: `${enabled ? "Enabled" : "Disabled"} ${e.name}. Takes effect the next time you sign in.` });
      load();
    } catch (err) {
      // Backend trả code "forbidden" khi thiếu quyền (không dò chữ — thông báo của Windows theo ngôn ngữ máy).
      setMsg({ tone: "error", text: `${e.name}: ${errorMessage(err)}`, needsAdmin: isApiError(err) && err.code === "forbidden" });
    } finally {
      setBusy(null);
    }
  };

  // Số trên mỗi tab = số dòng thật sự hiện ra (tính cả bộ lọc "Ẩn mục của Microsoft"),
  // kèm số mục Microsoft đang bị ẩn để hiện cạnh ô đánh dấu.
  const { counts, hiddenMs } = useMemo(() => {
    const c = { apps: 0, tasks: 0, services: 0 };
    const h = { apps: 0, tasks: 0, services: 0 };
    for (const e of entries ?? []) {
      const t = TAB_OF(e.source);
      if (t !== "apps" && hideMs && isMicrosoft(e)) h[t]++;
      else c[t]++;
    }
    return { counts: c, hiddenMs: h };
  }, [entries, hideMs]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (entries ?? [])
      .filter((e) => TAB_OF(e.source) === tab)
      .filter((e) => tab === "apps" || !hideMs || !isMicrosoft(e))
      .filter(
        (e) =>
          !q ||
          e.name.toLowerCase().includes(q) ||
          e.command.toLowerCase().includes(q) ||
          publisherText(e.publisher).toLowerCase().includes(q),
      )
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  }, [entries, tab, hideMs, query]);

  const appEntries = (entries ?? []).filter((e) => TAB_OF(e.source) === "apps");
  const enabledApps = appEntries.filter((e) => e.enabled).length;

  return (
    <PageShell
      title="Startup"
      subtitle={
        entries
          ? `${enabledApps} apps start with Windows · ${appEntries.length - enabledApps} disabled`
          : "Reading the registry, Startup folders, and Task Scheduler…"
      }
      actions={
        // "Tải lại" nằm cạnh ô tìm kiếm (không ở hàng tab): chữ "(đang ẩn N)" dài/ngắn không đẩy nó xuống dòng.
        <div className="flex items-center gap-2">
          <input
            type="search"
            placeholder="Search name, command, or publisher…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={`w-72 xl:w-96 ${INPUT}`}
          />
          <Button variant="ghost" size="sm" className="shrink-0" loading={reloading} onClick={reload}>
            {!reloading && <IconRefresh />}Refresh
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            title={t.hint}
            onClick={() => setTab(t.id)}
            className={pill(tab === t.id)}
          >
            {t.label} <span className="opacity-70">({counts[t.id]})</span>
          </button>
        ))}
        {tab !== "apps" && (
          <label className="ml-2 flex items-center gap-2 whitespace-nowrap text-sm">
            <input type="checkbox" checked={hideMs} onChange={(e) => setHideMs(e.target.checked)} />
            Hide Microsoft entries
            {hideMs && hiddenMs[tab] > 0 && <span className="opacity-60">({hiddenMs[tab]} hidden)</span>}
          </label>
        )}
      </div>

      <p className="mt-2 text-xs opacity-60">{TABS.find((t) => t.id === tab)?.hint}. Enable/disable works the same way as Task Manager and does not remove the original entry.</p>

      {msg && (
        <div className="mt-2">
          <Notice tone={msg.tone} onClose={() => setMsg(null)}>
            {msg.text}
            {msg.needsAdmin && (
              <span className="mt-2 block">
                <ElevateButton />
              </span>
            )}
          </Notice>
        </div>
      )}
      <div className="mt-2 empty:hidden">
        <AdminNotice>System-wide startup entries (HKLM and the common Startup folder) can only be enabled or disabled with administrator privileges.</AdminNotice>
      </div>
      {error && (
        <div className="mt-2">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      <div className={`mt-3 min-h-0 flex-1 overflow-auto ${SURFACE}`}>
        <table className="w-full table-fixed text-sm">
          <thead className={THEAD}>
            <tr className="text-left">
              <th className="px-3 py-2 font-medium opacity-70">Name</th>
              <th className="w-56 px-3 py-2 font-medium opacity-70">Publisher</th>
              <th className="w-56 px-3 py-2 font-medium opacity-70">Source</th>
              <th className="w-52 px-3 py-2 font-medium opacity-70">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const expanded = open === e.id;
              return [
                <tr
                  key={e.id}
                  onClick={() => setOpen(expanded ? null : e.id)}
                  className={`cursor-pointer border-t border-black/5 dark:border-white/5 ${expanded ? "bg-accent/10" : "hover:bg-black/5 dark:hover:bg-white/5"} ${e.enabled ? "" : "opacity-60"}`}
                >
                  <td className="truncate py-2 pl-3 pr-2" title={e.name}>
                    <span className="mr-1 inline-flex w-3 justify-center opacity-50">
                      <IconChevron open={expanded} />
                    </span>
                    {e.name}
                  </td>
                  <td className="truncate px-3">
                    <PublisherCell p={e.publisher} empty={e.path ? "File not found" : "—"} />
                  </td>
                  <td className="truncate px-3 text-xs opacity-70">{SOURCE_LABEL[e.source]}</td>
                  <td className="px-3">
                    {e.canToggle ? (
                      <div className="flex items-center gap-2">
                        <Toggle on={e.enabled} disabled={busy !== null} onChange={(v) => toggle(e, v)} />
                        <span className="text-xs">{busy === e.id ? "…" : e.enabled ? "Enabled" : "Disabled"}</span>
                      </div>
                    ) : e.source === "packagedTask" ? (
                      // App Store: chỉ Windows (Task Manager) bật/tắt được — API StartupTask chạy trong chính app đó.
                      <div className="flex items-center gap-2">
                        <span className="text-xs opacity-60">{e.enabled ? "Enabled" : "Disabled"}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Open Task Manager’s Startup tab to enable or disable Store apps"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            api.startupOpenSettings().catch((err) => setMsg({ tone: "error", text: errorMessage(err) }));
                          }}
                        >
                          Open Task Manager
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs opacity-60">{e.enabled ? "Enabled" : "Disabled"} · view only</span>
                    )}
                  </td>
                </tr>,
                expanded && (
                  <tr key={`${e.id}:d`} className="bg-accent/5">
                    <td colSpan={4} className="px-8 py-3 text-xs">
                      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
                        <dt className="opacity-60">Command</dt>
                        <dd className="break-all font-mono select-text">{e.command || "—"}</dd>
                        <dt className="opacity-60">Executable</dt>
                        <dd className="break-all select-text">{e.path ?? "—"}</dd>
                        <dt className="opacity-60">Location</dt>
                        <dd className="break-all select-text">{e.location}</dd>
                        {e.disabledAtMs != null && (
                          <>
                            <dt className="opacity-60">Disabled at</dt>
                            <dd>{new Date(e.disabledAtMs).toLocaleString("en-US")}</dd>
                          </>
                        )}
                        {e.note && (
                          <>
                            <dt className="opacity-60">{e.source === "scheduledTask" ? "Author" : "Note"}</dt>
                            <dd>{e.note}</dd>
                          </>
                        )}
                      </dl>
                    </td>
                  </tr>
                ),
              ];
            })}
            {entries && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-sm opacity-50">
                  No entries found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
