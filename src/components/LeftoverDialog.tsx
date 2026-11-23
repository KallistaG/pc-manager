import { IconCheck, IconX } from "./Icons";
import { DIALOG, PANEL } from "./ui";
import { useEffect, useMemo, useState } from "react";
import Button, { Spinner } from "./Button";
import { Notice } from "./Card";
import { usePageActive, useReportBusy } from "../hooks/usePageActive";
import ProgressBar from "./ProgressBar";
import { api, errorMessage, type Dependency, type LeftoverKind, type LeftoverProgress, type LeftoverReport, type LeftoverScan } from "../lib/api";
import { formatBytes } from "../lib/format";

const KIND_LABEL: Record<LeftoverKind, string> = {
  installDir: "Installation folder",
  dataDir: "Data / cache",
  shortcut: "Shortcut Start Menu",
  registry: "Registry",
};

type Phase = "scan" | "review" | "confirm" | "clean" | "done";

export interface LeftoverTarget {
  id: string;
  name: string;
  /** Mở tự động ngay sau khi trình gỡ chạy xong. */
  afterUninstall?: boolean;
}

const DEP_LABEL: Record<Dependency["kind"], string> = { service: "Service", driver: "Driver", task: "Scheduled task" };

/**
 * Dọn phần còn sót của một app: Quét → Xem & chọn → Xác nhận → Dọn.
 * File/thư mục vào Thùng rác (khôi phục được); key registry được sao lưu .reg trước khi xoá.
 */
export default function LeftoverDialog({ app, onClose }: { app: LeftoverTarget | null; onClose: (changed: boolean) => void }) {
  const [phase, setPhase] = useState<Phase>("scan");
  const [scan, setScan] = useState<LeftoverScan | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [report, setReport] = useState<LeftoverReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<LeftoverProgress | null>(null);

  useEffect(() => {
    if (!app) return;
    setPhase("scan");
    setScan(null);
    setReport(null);
    setError(null);
    let alive = true;
    api
      .appsLeftoversScan(app.id)
      .then((s) => {
        if (!alive) return;
        setScan(s);
        setSelected(new Set(s.items.filter((i) => i.confidence === "strong" && !i.blocked).map((i) => i.id)));
        setPhase("review");
      })
      .catch((e) => alive && (setError(errorMessage(e)), setPhase("review")));
    return () => {
      alive = false;
    };
  }, [app]);

  const busy = phase === "scan" || phase === "clean";
  // Hộp thoại luôn được mount (trả về null khi đóng) và `phase` khởi đầu là "scan" =>
  // chỉ báo "đang chạy" khi đang mở cho một app.
  useReportBusy(app !== null && busy);
  // Trang đang ẩn (vẫn giữ sống) => không nhận phím của trang khác.
  const active = usePageActive();
  useEffect(() => {
    if (!app || !active) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose(phase === "done");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app, busy, phase, onClose, active]);

  const chosen = useMemo(() => (scan?.items ?? []).filter((i) => selected.has(i.id)), [scan, selected]);
  const chosenBytes = chosen.reduce((s, i) => s + (i.bytes ?? 0), 0);
  const chosenRegistry = chosen.some((i) => i.kind === "registry");

  if (!app) return null;

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const clean = async () => {
    if (!scan) return;
    setPhase("clean");
    setError(null);
    setProgress(null);
    try {
      setReport(await api.appsLeftoversClean(scan.scanId, [...selected], setProgress));
    } catch (e) {
      setError(errorMessage(e));
    }
    setPhase("done");
  };

  const outcome = (id: number) => report?.items.find((o) => o.id === id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && onClose(phase === "done")}>
      <div
        role="dialog"
        aria-modal="true"
        className={`flex max-h-[85vh] w-full max-w-3xl flex-col p-5 ${DIALOG}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">Clean leftovers — {app.name}</h2>
        <p className="mt-1 text-xs opacity-70">
          Use this if the uninstaller fails or leaves files behind. Files and folders are moved to the <b>Recycle Bin</b> (so they can be restored); registry entries are backed up to a <code>.reg</code> file before removal.
        </p>

        {app.afterUninstall && phase !== "done" && (
          <div className="mt-3">
            <Notice tone="ok">The uninstaller has finished. Here are the items it left behind.</Notice>
          </div>
        )}
        {scan && scan.dependencies.length > 0 && phase !== "done" && (
          <div className="mt-3">
            <Notice tone="error">
              <span className="block">
                There are still {scan.dependencies.length} system components using these folders. Removing files they depend on may cause startup problems — uninstall the app first with its uninstaller (or official removal tool). Related items are not selected by default.
              </span>
              <span className="mt-1 block text-xs">
                {scan.dependencies.slice(0, 6).map((d) => (
                  <span key={`${d.kind}${d.name}`} className="block truncate" title={d.command}>
                    • {DEP_LABEL[d.kind]}: {d.name}
                  </span>
                ))}
                {scan.dependencies.length > 6 && <span className="block">… and {scan.dependencies.length - 6} more</span>}
              </span>
            </Notice>
          </div>
        )}
        {scan?.uninstallerExists && !app.afterUninstall && phase === "review" && (
          <div className="mt-3">
            <Notice tone="error">
              The app’s uninstaller is still available. Try "Uninstall" first — use this cleanup only if the uninstaller fails (for example, NetBeans “Missing target component”) or leaves files behind.
            </Notice>
          </div>
        )}
        {error && (
          <div className="mt-3">
            <Notice tone="error">{error}</Notice>
          </div>
        )}

        <div className={`mt-3 min-h-0 flex-1 overflow-auto ${PANEL}`}>
          {phase === "scan" ? (
            <div className="flex items-center justify-center gap-3 py-12 text-sm opacity-70">
              <Spinner /> Searching for leftover folders, shortcuts, and registry entries…
            </div>
          ) : scan && scan.items.length === 0 ? (
            <div className="py-10 text-center text-sm opacity-60">No leftovers found.</div>
          ) : (
            <ul className="divide-y divide-black/5 text-sm dark:divide-white/5">
              {scan?.items.map((i) => {
                const o = outcome(i.id);
                const disabled = !!i.blocked || phase !== "review";
                return (
                  <li key={i.id} className={`flex items-start gap-3 px-3 py-2 ${i.blocked ? "opacity-50" : ""}`}>
                    <input
                      type="checkbox"
                      className="mt-1 accent-[var(--color-accent)]"
                      checked={selected.has(i.id)}
                      disabled={disabled}
                      onChange={() => toggle(i.id)}
                      aria-label={i.path}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium">{KIND_LABEL[i.kind]}</span>
                        {i.confidence === "possible" && (
                          <span
                            className="rounded bg-amber-100 px-1.5 text-[11px] text-amber-800 dark:bg-amber-500/20 dark:text-amber-200"
                            title="Only a partial name match — review before selecting"
                          >
                            possible
                          </span>
                        )}
                        {o && (
                          <span className={`text-xs ${o.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                            {o.ok ? <IconCheck /> : <IconX />} {o.ok ? "Cleaned" : (o.message ?? "Error")}
                          </span>
                        )}
                      </div>
                      <div className="break-all font-mono text-xs" title={i.path}>
                        {i.path}
                      </div>
                      <div className="text-xs opacity-60">{i.blocked ? `Cannot clean: ${i.blocked}` : i.reason}</div>
                    </div>
                    <div className="w-20 shrink-0 text-right text-xs tabular-nums opacity-80">{i.bytes != null ? formatBytes(i.bytes) : ""}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {phase === "confirm" && (
          <div className="mt-3">
            <Notice tone="error">
              Move {chosen.filter((i) => i.kind !== "registry").length} item(s) ({formatBytes(chosenBytes)}) to the Recycle Bin{chosenRegistry && " and remove registry entries (backed up to .reg)"}. The app will no longer run if you clean its installation folder. Continue?
            </Notice>
          </div>
        )}
        {phase === "clean" && (
          <ProgressBar
            className="mt-3"
            pct={progress && progress.total > 0 ? (progress.done / progress.total) * 100 : null}
            label={progress ? `Cleaning ${progress.done + 1} / ${progress.total}: ${progress.current}` : "Cleaning…"}
          />
        )}
        {phase === "done" && report && (
          <div className="mt-3">
            <Notice tone={report.failed ? "error" : "ok"}>
              Moved {report.recycled} item(s) ({formatBytes(report.recycledBytes)}) to the Recycle Bin
              {report.registryRemoved && ", registry entries removed"}
              {report.failed > 0 && `, ${report.failed} item(s) failed`}.
              {report.backup && <span className="mt-1 block break-all text-xs opacity-80">Registry backup: {report.backup}</span>}
            </Notice>
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          {phase === "review" && (
            <span className="mr-auto text-xs opacity-70">
              Selected {chosen.length} item(s) · {formatBytes(chosenBytes)}
            </span>
          )}
          {phase === "done" ? (
            <Button onClick={() => onClose(true)}>Close</Button>
          ) : phase === "confirm" ? (
            <>
              <Button variant="ghost" onClick={() => setPhase("review")}>
                Back
              </Button>
              <Button variant="danger" onClick={clean}>
                Confirm cleanup
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => onClose(false)}>
                Cancel
              </Button>
              <Button variant="danger" loading={phase === "clean"} disabled={phase !== "review" || chosen.length === 0} onClick={() => setPhase("confirm")}>
                Clean selected items
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
