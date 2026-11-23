import { IconSparkle } from "../components/Icons";
import { useReportBusy } from "../hooks/usePageActive";
import { useJobResume } from "../hooks/useJobResume";
import { useMemo, useState } from "react";
import Button from "../components/Button";
import { Card, Notice } from "../components/Card";
import ConfirmDialog, { type ConfirmRequest } from "../components/ConfirmDialog";
import PageShell from "../components/PageShell";
import ProgressBar from "../components/ProgressBar";
import SystemDeepClean from "../components/SystemDeepClean";
import { AdminNotice } from "../components/Elevation";
import { api, errorMessage, type CleanerProgress, type CleanReport, type Risk, type RuleScan, type ScanResult } from "../lib/api";
import { formatBytes } from "../lib/format";

type Phase = "idle" | "scanning" | "preview" | "cleaning" | "report";

const RISK: Record<Risk, { label: string; cls: string; hint: string }> = {
  low: { label: "Safe", cls: "bg-green-500/15 text-green-700 dark:text-green-300", hint: "Windows or apps will recreate these when needed" },
  medium: { label: "Use caution", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300", hint: "May be useful when troubleshooting" },
  high: { label: "Irreversible", cls: "bg-red-500/15 text-red-700 dark:text-red-300", hint: "Data you deleted" },
};

const isReady = (r: RuleScan) => r.status.kind === "ready";

function statusNote(r: RuleScan): string | null {
  switch (r.status.kind) {
    case "empty":
      return r.skippedYoung > 0 ? `Only recently created files (${r.skippedYoung}) — kept` : "Nothing to clean";
    case "needsAdmin":
      return "Run PC Manager as administrator";
    case "blocked":
      return r.status.reason;
    case "error":
      return `Error: ${r.status.message}`;
    default:
      return null;
  }
}

function ProgressView({ p, onCancel, cancelling }: { p: CleanerProgress | null; onCancel: () => void; cancelling: boolean }) {
  // Dọn: % theo số file (một rule 100.000 file thì thanh vẫn chạy); quét: theo số rule.
  const pct = !p
    ? 0
    : p.phase === "clean" && p.totalFiles > 0
      ? Math.min(100, Math.round((p.files / p.totalFiles) * 100))
      : p.totalRules > 0
        ? Math.round((p.doneRules / p.totalRules) * 100)
        : 0;
  const verb = p?.phase === "clean" ? "Cleaning" : "Scanning";
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <div className="text-lg font-semibold">
            {verb}… {pct}%
          </div>
          <div className="truncate text-sm opacity-70">{p?.current ?? "Preparing…"}</div>
        </div>
        <Button variant="secondary" onClick={onCancel} loading={cancelling}>
          {cancelling ? "Cancelling…" : "Cancel"}
        </Button>
      </div>
      <ProgressBar pct={pct} label={p ? `${p.files.toLocaleString("en-US")} files · ${formatBytes(p.bytes)}` : "Preparing…"} />
    </Card>
  );
}

function RuleRow({ r, checked, onToggle }: { r: RuleScan; checked: boolean; onToggle: () => void }) {
  const ready = isReady(r);
  const note = statusNote(r);
  const risk = RISK[r.risk];
  return (
    <label
      className={`flex items-start gap-3 border-t border-black/5 px-4 py-3 first:border-t-0 dark:border-white/5 ${
        ready ? "cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.03]" : "cursor-not-allowed opacity-55"
      }`}
    >
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]" checked={checked} disabled={!ready} onChange={onToggle} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{r.name}</span>
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${risk.cls}`} title={risk.hint}>
            {risk.label}
          </span>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed opacity-65">{r.description}</p>
        {note && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{note}</p>}
        {ready && r.skippedYoung > 0 && (
          <p className="mt-1 text-xs opacity-60">Kept {r.skippedYoung.toLocaleString("en-US")} recently created files</p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <div className="font-semibold tabular-nums">{ready ? formatBytes(r.bytes) : "—"}</div>
        {ready && <div className="text-xs tabular-nums opacity-60">{r.files.toLocaleString("en-US")} items</div>}
      </div>
    </label>
  );
}

function ReportView({ rep, onRescan, onRealClean }: { rep: CleanReport; onRescan: () => void; onRealClean?: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        {rep.dryRun && <div className="mb-3"><Notice tone="warn">Dry run — no files have been deleted.</Notice></div>}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-sm opacity-70">{rep.dryRun ? "Will free" : "Freed"}</div>
            <div className="text-4xl font-semibold text-green-600 tabular-nums dark:text-green-400">{formatBytes(rep.freedBytes)}</div>
            <div className="mt-1 text-sm opacity-70">
              {rep.deletedFiles.toLocaleString("en-US")} items · {(rep.durationMs / 1000).toFixed(1)} seconds
              {rep.cancelled && " · cancelled early"}
            </div>
          </div>
          <div className="flex gap-2">
            {onRealClean && (
              <Button variant="primary" onClick={onRealClean}>
                Clean now
              </Button>
            )}
            <Button variant="secondary" onClick={onRescan}>
              Scan again
            </Button>
          </div>
        </div>
        {(rep.skippedLocked > 0 || rep.skippedChanged > 0 || rep.errors > 0) && (
          <p className="mt-3 text-sm opacity-75">
            Skipped: {rep.skippedLocked > 0 && `${rep.skippedLocked} files in use`}
            {rep.skippedLocked > 0 && rep.skippedChanged > 0 && " · "}
            {rep.skippedChanged > 0 && `${rep.skippedChanged} files changed since the scan`}
            {rep.errors > 0 && ` · ${rep.errors} errors`}. This is expected: PC Manager never forces deletion of files in use.
          </p>
        )}
      </Card>
      <Card className="overflow-hidden !p-0">
        <div className="px-4 pt-3 pb-2 text-sm font-medium opacity-70">Details</div>
        <table className="w-full text-sm">
          <tbody>
            {rep.rules.map((r) => (
              <tr key={r.id} className="border-t border-black/5 dark:border-white/5">
                <td className="px-4 py-2">
                  {r.name}
                  {r.message && <div className="text-xs text-amber-700 dark:text-amber-300">{r.message}</div>}
                  {r.firstError && <div className="truncate text-xs text-red-600 dark:text-red-400">{r.firstError}</div>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatBytes(r.freedBytes)}</td>
                <td className="px-4 py-2 text-right text-xs tabular-nums opacity-70">
                  {r.deletedFiles.toLocaleString("en-US")} items
                  {r.skippedLocked + r.skippedChanged > 0 && ` · skipped ${(r.skippedLocked + r.skippedChanged).toLocaleString("en-US")}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export default function Cleaner() {
  const [phase, setPhase] = useState<Phase>("idle");
  useReportBusy(phase === "scanning" || phase === "cleaning");
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<CleanerProgress | null>(null);
  const [report, setReport] = useState<CleanReport | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const startScan = async () => {
    setPhase("scanning");
    setError(null);
    setProgress(null);
    setReport(null);
    setCancelling(false);
    try {
      applyScan(await api.cleanerScan(setProgress));
    } catch (e) {
      setError(errorMessage(e));
      setPhase("idle");
    }
  };

  const applyScan = (r: ScanResult) => {
    setScan(r);
    setSelected(new Set(r.rules.filter((x) => isReady(x) && x.defaultSelected).map((x) => x.id)));
    setPhase(r.cancelled ? "idle" : "preview");
    if (r.cancelled) setError("Scan cancelled.");
  };

  // Cửa sổ bị đóng (xuống tray) lúc đang quét/dọn rồi mở lại: backend vẫn chạy => hiện lại tiến độ
  // và kết quả khi xong.
  const resuming = (p: CleanerProgress | null) => {
    setError(null);
    setReport(null);
    setCancelling(false);
    setProgress(p);
  };
  useJobResume<CleanerProgress>("cleaner.scan", {
    onRunning: (p) => {
      resuming(p);
      setPhase("scanning");
    },
    onProgress: setProgress,
    onDone: (o) => {
      if (o.ok) applyScan(o.value as ScanResult);
      else {
        setError(errorMessage(o.value));
        setPhase("idle");
      }
    },
  });
  useJobResume<CleanerProgress>("cleaner.clean", {
    onRunning: (p) => {
      resuming(p);
      setPhase("cleaning");
    },
    onProgress: setProgress,
    onDone: (o) => {
      if (o.ok) {
        setReport(o.value as CleanReport);
        setPhase("report");
      } else {
        setError(errorMessage(o.value));
        setPhase(scan ? "preview" : "idle");
      }
    },
  });

  const runClean = async (dry: boolean) => {
    if (!scan) return;
    setPhase("cleaning");
    setError(null);
    setProgress(null);
    setCancelling(false);
    try {
      const ids = scan.rules.filter((r) => selected.has(r.id)).map((r) => r.id);
      setReport(await api.cleanerClean(scan.scanId, ids, dry, setProgress));
      setPhase("report");
    } catch (e) {
      setError(errorMessage(e));
      setPhase("preview");
    }
  };

  const cancel = () => {
    setCancelling(true);
    api.cleanerCancel().catch(() => {});
  };

  const groups = useMemo(() => {
    const m = new Map<string, RuleScan[]>();
    for (const r of scan?.rules ?? []) m.set(r.group, [...(m.get(r.group) ?? []), r]);
    return [...m.entries()];
  }, [scan]);

  const chosen = (scan?.rules ?? []).filter((r) => selected.has(r.id) && isReady(r));
  const chosenBytes = chosen.reduce((s, r) => s + r.bytes, 0);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const toggleGroup = (rules: RuleScan[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      for (const r of rules.filter(isReady)) {
        if (on) n.add(r.id);
        else n.delete(r.id);
      }
      return n;
    });

  const askClean = () => {
    if (dryRun) return void runClean(true);
    const warns = [
      chosen.some((r) => r.risk === "high") && "The Recycle Bin will be emptied — this cannot be undone.",
      chosen.some((r) => r.usesService) && "The Windows Update service will be paused during cleanup and restarted afterward.",
    ].filter(Boolean) as string[];
    setConfirm({
      title: `Clean up ${formatBytes(chosenBytes)}?`,
      body: (
        <div className="space-y-2">
          <p>
            {chosen.length} item(s): {chosen.map((r) => r.name).join(", ")}.
          </p>
          <p className="text-xs opacity-70">Files in use, recently created files, and files changed since the scan will be skipped.</p>
          {warns.map((w) => (
            <p key={w} className="text-amber-700 dark:text-amber-300">
              {w}
            </p>
          ))}
        </div>
      ),
      confirmLabel: "Clean",
      danger: chosen.some((r) => r.risk === "high"),
      onConfirm: () => runClean(false),
    });
  };

  return (
    <PageShell
      title="Junk Cleaner"
      subtitle="Scan → review → choose → clean. Only items covered by the junk-cleaning rules are removed; personal data is left untouched."
      actions={
        (phase === "idle" || phase === "preview") && (
          <Button variant={phase === "idle" ? "primary" : "secondary"} onClick={startScan}>
            {phase === "idle" ? "Scan now" : "Scan again"}
          </Button>
        )
      }
    >
      {error && (
        <div className="mb-4">
          <Notice tone="error" onClose={() => setError(null)}>{error}</Notice>
        </div>
      )}
      <div className="mb-4 empty:hidden">
        <AdminNotice>Windows\Temp, system crash dumps, and the Windows Update cache… can only be cleaned with administrator privileges.</AdminNotice>
      </div>

      {phase === "idle" && (
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <IconSparkle className="h-10 w-10 text-accent" />
          <p className="max-w-lg text-sm opacity-70">
            Scan temporary files, browser caches, error reports, installed Windows updates, and the Recycle Bin. Nothing is deleted until you
            review the results and confirm.
          </p>
          <Button variant="primary" onClick={startScan}>
            Scan now
          </Button>
        </Card>
      )}

      {(phase === "scanning" || phase === "cleaning") && <ProgressView p={progress} onCancel={cancel} cancelling={cancelling} />}

      {phase === "report" && report && (
        <ReportView rep={report} onRescan={startScan} onRealClean={report.dryRun ? () => runClean(false) : undefined} />
      )}

      {phase === "preview" && scan && (
        <>
          {/* auto-rows-max: rows match their content instead of shrinking when
              the container is short (the card uses overflow-hidden, so min-height is 0). */}
          <div className="grid min-h-0 flex-1 auto-rows-max content-start items-start gap-4 overflow-auto pb-4 xl:grid-cols-2">
            {groups.map(([group, rules]) => {
              const ready = rules.filter(isReady);
              const on = ready.filter((r) => selected.has(r.id)).length;
              const bytes = ready.reduce((s, r) => s + r.bytes, 0);
              return (
                <Card key={group} className="overflow-hidden !p-0">
                  <label className={`flex items-center gap-3 bg-black/[0.03] px-4 py-2.5 dark:bg-white/[0.04] ${ready.length ? "cursor-pointer" : ""}`}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--color-accent)]"
                      disabled={!ready.length}
                      checked={ready.length > 0 && on === ready.length}
                      ref={(el) => {
                        if (el) el.indeterminate = on > 0 && on < ready.length;
                      }}
                      onChange={(e) => toggleGroup(rules, e.target.checked)}
                    />
                    <span className="flex-1 font-semibold">{group}</span>
                    <span className="text-sm tabular-nums opacity-70">{formatBytes(bytes)}</span>
                  </label>
                  {rules.map((r) => (
                    <RuleRow key={r.id} r={r} checked={selected.has(r.id)} onToggle={() => toggle(r.id)} />
                  ))}
                </Card>
              );
            })}
          </div>

          {/* Keep the action bar pinned to the bottom. */}
          <div className="flex flex-wrap items-center gap-4 rounded-lg bg-white px-4 py-3 shadow-sm dark:bg-white/5">
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold tabular-nums">{formatBytes(chosenBytes)}</div>
              <div className="text-xs opacity-60">
                {chosen.length} items selected · scan took {(scan.durationMs / 1000).toFixed(1)} seconds
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm" title="Run all checks without deleting anything">
              <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="accent-[var(--color-accent)]" />
              Dry run (no deletion)
            </label>
            <Button variant="primary" disabled={chosen.length === 0} onClick={askClean}>
              {dryRun ? "Dry run" : `Clean ${formatBytes(chosenBytes)}`}
            </Button>
          </div>
        </>
      )}

      <ConfirmDialog req={confirm} onClose={() => setConfirm(null)} />
      <SystemDeepClean />
    </PageShell>
  );
}
