import { IconRefresh } from "../components/Icons";
import { INPUT, SELECT, SURFACE, THEAD, pill } from "../components/ui";
import { useReportBusy } from "../hooks/usePageActive";
import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "../components/Button";
import ProgressBar from "../components/ProgressBar";
import { Card, Notice } from "../components/Card";
import ConfirmDialog, { type ConfirmRequest } from "../components/ConfirmDialog";
import LeftoverDialog, { type LeftoverTarget } from "../components/LeftoverDialog";
import { AdminNotice } from "../components/Elevation";
import PageShell from "../components/PageShell";
import { useJobResume } from "../hooks/useJobResume";
import {
  api,
  errorMessage,
  type AppsOverview,
  type AppsProgress,
  type InstalledApp,
  type LeftoverProgress,
  type LeftoverReport,
  type UsageSource,
} from "../lib/api";
import { daysAgo, formatBytes, formatDate, relativeDays } from "../lib/format";

type SortKey = "size" | "name" | "lastUsed" | "installed";

const UNUSED_FILTERS: { days: number; label: string }[] = [
  { days: 0, label: "All apps" },
  { days: 30, label: "Unused for > 30 days" },
  { days: 90, label: "> 90 days" },
  { days: 180, label: "> 6 months" },
  { days: 365, label: "> 1 year" },
];

const SOURCE_LABEL: Record<UsageSource, string> = {
  userAssist: "Windows records launches from Start or File Explorer (UserAssist)",
  prefetch: "Windows Prefetch",
  pcManager: "Observed running by PC Manager",
};

function LastUsed({ a }: { a: InstalledApp }) {
  if (a.lastUsedMs == null) {
    return (
      <span className="opacity-50" title="No source recorded a launch. The app may run in the background, be launched from the command line, or have never been used.">
        Unknown
      </span>
    );
  }
  const d = daysAgo(a.lastUsedMs);
  const tone = d > 365 ? "text-red-600 dark:text-red-400" : d > 90 ? "text-amber-700 dark:text-amber-300" : "";
  return (
    <span className={tone} title={`${formatDate(a.lastUsedMs)} — theo ${a.lastUsedSource ? SOURCE_LABEL[a.lastUsedSource] : "?"}`}>
      {relativeDays(d)}
    </span>
  );
}

export default function Apps() {
  const [data, setData] = useState<AppsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [unusedDays, setUnusedDays] = useState(0);
  const [includeUnknown, setIncludeUnknown] = useState(false);
  const [sort, setSort] = useState<SortKey>("size");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  useReportBusy(busyId !== null);
  const [leftoverApp, setLeftoverApp] = useState<LeftoverTarget | null>(null);
  /** App đang chạy trình gỡ — chờ backend báo xong. */
  const [uninstalling, setUninstalling] = useState<Set<string>>(new Set());

  const [loadProgress, setLoadProgress] = useState<AppsProgress | null>(null);
  const load = useCallback(() => {
    setLoading(true);
    setLoadProgress(null);
    api
      .appsList(setLoadProgress)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, []);
  // Mở trang: nếu backend đang/đã đọc danh sách (cửa sổ trước bị đóng giữa chừng) thì nối lại
  // (useJobResume bên dưới) thay vì chạy lần thứ hai.
  useEffect(() => {
    let alive = true;
    api
      .jobsSnapshot()
      .then((list) => alive && !list.some((j) => j.kind === "apps.list") && load())
      .catch(() => alive && load());
    return () => {
      alive = false;
    };
  }, [load]);
  useJobResume<AppsProgress>("apps.list", {
    onRunning: (p) => {
      setLoading(true);
      setLoadProgress(p);
    },
    onProgress: setLoadProgress,
    onDone: (o) => {
      setLoading(false);
      if (o.ok) {
        setData(o.value as AppsOverview);
        setError(null);
      } else setError(errorMessage(o.value));
    },
  });
  // Đóng cửa sổ lúc đang dọn phần còn sót rồi mở lại: hiện tiến độ / kết quả ở đầu trang.
  const [leftoverProgress, setLeftoverProgress] = useState<LeftoverProgress | null>(null);
  const [leftoverRunning, setLeftoverRunning] = useState(false);
  useReportBusy(leftoverRunning);
  useJobResume<LeftoverProgress>("apps.leftovers", {
    onRunning: (p) => {
      setLeftoverRunning(true);
      setLeftoverProgress(p);
    },
    onProgress: setLeftoverProgress,
    onDone: (o) => {
      setLeftoverRunning(false);
      setLeftoverProgress(null);
      if (o.ok) {
        const r = o.value as LeftoverReport;
        setMsg({
          tone: r.failed ? "error" : "ok",
          text:
            `Leftover cleanup complete: ${r.recycled} item(s) (${formatBytes(r.recycledBytes)}) moved to the Recycle Bin` +
            (r.registryRemoved ? ", registry entries removed (backed up to .reg)" : "") +
            (r.failed ? `, ${r.failed} item(s) failed` : "") +
            ".",
        });
        load();
      } else setError(errorMessage(o.value));
    },
  });

  // Trình gỡ chạy xong: tải lại danh sách; gỡ thành công thì mở luôn "Dọn phần còn sót".
  useEffect(() => {
    const un = api.onUninstallFinished((e) => {
      setUninstalling((prev) => {
        const next = new Set(prev);
        next.delete(e.id);
        return next;
      });
      load();
      if (e.timedOut) {
        setMsg({ tone: "error", text: `${e.name}: the uninstaller is taking too long; PC Manager stopped monitoring it. When it finishes, click "Clean leftovers".` });
      } else if (e.stillInstalled) {
        setMsg({
          tone: "error",
          text: `The ${e.name} uninstaller closed, but the app is still installed (cancelled or failed). If the uninstaller reported an error, use "Clean leftovers".`,
        });
      } else {
        setMsg({ tone: "ok", text: `Uninstalled ${e.name}. Looking for leftovers…` });
        setLeftoverApp({ id: e.id, name: e.name, afterUninstall: true });
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, [load]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = Date.now();
    const list = (data?.apps ?? []).filter((a) => {
      if (q && !`${a.name} ${a.publisher ?? ""}`.toLowerCase().includes(q)) return false;
      if (unusedDays === 0) return true;
      if (a.lastUsedMs == null) {
        // Không rõ lần dùng: chỉ tính khi người dùng muốn VÀ đã cài đủ lâu.
        return includeUnknown && (a.installDateMs == null || daysAgo(a.installDateMs, now) > unusedDays);
      }
      return daysAgo(a.lastUsedMs, now) > unusedDays;
    });
    const by: Record<SortKey, (a: InstalledApp, b: InstalledApp) => number> = {
      size: (a, b) => (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1),
      name: (a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
      // Lâu chưa dùng lên đầu; "chưa rõ" xuống cuối.
      lastUsed: (a, b) => (a.lastUsedMs ?? Infinity) - (b.lastUsedMs ?? Infinity),
      installed: (a, b) => (a.installDateMs ?? Infinity) - (b.installDateMs ?? Infinity),
    };
    return [...list].sort((a, b) => by[sort](a, b) || a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  }, [data, query, unusedDays, includeUnknown, sort]);

  const totalSize = rows.reduce((s, a) => s + (a.sizeBytes ?? 0), 0);

  const uninstall = (a: InstalledApp) =>
    setConfirm({
      title: `Uninstall ${a.name}?`,
      body: (
        <div className="space-y-2">
          <p>PC Manager will open this app’s uninstaller. Follow the instructions in that window to finish.</p>
          <p>After uninstalling, PC Manager will look for leftovers (cache, AppData, shortcuts…) for you to review and clean.</p>
          {a.lastUsedMs != null && (
            <p className="text-xs opacity-70">
              Last used: {formatDate(a.lastUsedMs)} ({relativeDays(daysAgo(a.lastUsedMs))}).
            </p>
          )}
        </div>
      ),
      confirmLabel: "Open uninstaller",
      danger: true,
      onConfirm: async () => {
        setBusyId(a.id);
        setMsg(null);
        try {
          const name = await api.appsUninstall(a.id);
          setUninstalling((prev) => new Set(prev).add(a.id));
          setMsg({
            tone: "ok",
            text: `Opened the ${name} uninstaller. Follow its instructions — PC Manager will look for leftovers when it finishes.`,
          });
        } catch (e) {
          setMsg({ tone: "error", text: `${a.name}: ${errorMessage(e)}` });
        } finally {
          setBusyId(null);
        }
      },
    });

  return (
    <PageShell
      title="Apps"
      subtitle="Installed apps, disk usage, and last-used times — find apps you no longer use and uninstall them."
      actions={
        <div className="flex items-center gap-2">
          <input
            type="search"
            placeholder="Search name or publisher…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={`w-64 xl:w-80 ${INPUT}`}
          />
          <Button variant="ghost" size="sm" className="shrink-0" loading={loading} onClick={load}>
            {!loading && <IconRefresh />}Refresh
          </Button>
          {/* Keep sorting on the top row so the unknown-usage filter does not push it to a new line. */}
          <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className={SELECT}
            >
              <option value="size">Size</option>
              <option value="lastUsed">Least recently used</option>
              <option value="installed">Oldest installed</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {UNUSED_FILTERS.map((f) => (
          <button
            key={f.days}
            type="button"
            onClick={() => setUnusedDays(f.days)}
            className={pill(unusedDays === f.days)}
          >
            {f.label}
          </button>
        ))}
        {unusedDays > 0 && (
          <label className="ml-1 flex cursor-pointer items-center gap-2 whitespace-nowrap text-sm" title="No source has recorded a launch, and the app has been installed longer than the selected period">
            <input type="checkbox" checked={includeUnknown} onChange={(e) => setIncludeUnknown(e.target.checked)} className="accent-[var(--color-accent)]" />
            Include apps with unknown usage
          </label>
        )}
      </div>

      {data && (
        <p className="mt-2 text-xs opacity-60">
          Last-used data from: UserAssist ({data.userassistEntries} entries) ·{" "}
          {data.prefetchEntries != null ? `Prefetch (${data.prefetchEntries} entries)` : "Prefetch (requires administrator privileges)"} · PC Manager
          {data.trackingSinceMs != null ? ` tracking since ${formatDate(data.trackingSinceMs)}` : " (tracking just started)"}.
        </p>
      )}
      {data && data.prefetchEntries == null && (
        <div className="mt-2 empty:hidden">
          <AdminNotice>Administrator privileges are required to read Prefetch (for more accurate last-used data) and uninstall or clean leftovers for system-wide apps.</AdminNotice>
        </div>
      )}

      {leftoverRunning && (
        <Card className="mt-3">
          <ProgressBar
            pct={leftoverProgress && leftoverProgress.total > 0 ? (leftoverProgress.done / leftoverProgress.total) * 100 : null}
            label={leftoverProgress ? `Cleaning leftovers ${leftoverProgress.done + 1} / ${leftoverProgress.total}: ${leftoverProgress.current}` : "Cleaning leftovers…"}
          />
        </Card>
      )}
      {(msg || error) && (
        <div className="mt-3">
          <Notice
            tone={msg?.tone ?? "error"}
            onClose={() => {
              setMsg(null);
              setError(null);
            }}
          >
            {msg?.text ?? error}
          </Notice>
        </div>
      )}

      {loading && !data ? (
        <Card className="mt-3 py-10">
          <ProgressBar
            className="mx-auto max-w-md"
            pct={loadProgress && loadProgress.total > 0 ? (loadProgress.done / loadProgress.total) * 100 : null}
            label={
              loadProgress && loadProgress.total > 0
                ? `Loading apps and measuring size: ${loadProgress.done} / ${loadProgress.total}`
                : "Loading app list…"
            }
          />
        </Card>
      ) : (
        <>
          <div className="mt-3 text-sm opacity-70">
            {rows.length} apps · {formatBytes(totalSize)} total
            {unusedDays > 0 && rows.length > 0 && " can be uninstalled to free up space"}
          </div>
          <div className={`mt-2 min-h-0 flex-1 overflow-auto ${SURFACE}`}>
            <table className="w-full table-fixed text-sm">
              <thead className={`text-left ${THEAD}`}>
                <tr>
                  <th className="px-4 py-2 font-medium opacity-70">App</th>
                  <th className="w-28 px-3 py-2 text-right font-medium opacity-70">Size</th>
                  <th className="w-28 px-3 py-2 font-medium opacity-70">Installed</th>
                  <th className="w-36 px-3 py-2 font-medium opacity-70">Last used</th>
                  <th className="w-52 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-t border-black/5 hover:bg-black/[0.03] dark:border-white/5 dark:hover:bg-white/[0.03]">
                    <td className="px-4 py-2" title={a.installLocation ?? undefined}>
                      <div className="truncate font-medium">{a.name}</div>
                      <div className="truncate text-xs opacity-60">
                        {[a.storeApp ? "App Store" : null, a.publisher, a.version].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </td>
                    <td className="px-3 text-right tabular-nums" title={a.sizeMeasured ? "Measured from the installation folder" : "Reported by the app"}>
                      {a.sizeBytes != null ? `${a.sizeMeasured ? "" : "≈ "}${formatBytes(a.sizeBytes)}` : <span className="opacity-40">—</span>}
                    </td>
                    <td className="px-3 tabular-nums opacity-80">{a.installDateMs != null ? formatDate(a.installDateMs) : <span className="opacity-40">—</span>}</td>
                    <td className="px-3">
                      <LastUsed a={a} />
                    </td>
                    <td className="whitespace-nowrap px-3 text-right">
                      {a.storeApp ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Managed by Windows — open Settings → Apps to uninstall"
                          onClick={() => api.appsOpenSettings().catch((e) => setError(errorMessage(e)))}
                        >
                          Uninstall in Settings
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busyId !== null}
                            title="Find leftover folders, shortcuts, and registry entries — move files to the Recycle Bin"
                            onClick={() => setLeftoverApp(a)}
                          >
                            Clean leftovers
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 dark:text-red-400"
                            disabled={!a.canUninstall || busyId !== null || uninstalling.has(a.id)}
                            loading={busyId === a.id || uninstalling.has(a.id)}
                            title={a.canUninstall ? undefined : "This app cannot be uninstalled from here"}
                            onClick={() => uninstall(a)}
                          >
                            {uninstalling.has(a.id) ? "Uninstalling…" : "Uninstall"}
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm opacity-50">
                      {unusedDays > 0 ? "No unused apps match this filter" : "No apps found"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <ConfirmDialog req={confirm} onClose={() => setConfirm(null)} />
      <LeftoverDialog
        app={leftoverApp}
        onClose={(changed) => {
          setLeftoverApp(null);
          if (changed) load();
        }}
      />
    </PageShell>
  );
}
