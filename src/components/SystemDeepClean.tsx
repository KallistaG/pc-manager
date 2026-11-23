import { PANEL } from "./ui";
import { useEffect, useState } from "react";
import Button, { Spinner } from "./Button";
import { Card, Notice } from "./Card";
import ConfirmDialog, { type ConfirmRequest } from "./ConfirmDialog";
import { AdminNotice, useElevation } from "./Elevation";
import { api, errorMessage, type SystemCleanReport, type WinSxsAnalysis, type WindowsOldInfo } from "../lib/api";
import { formatBytes } from "../lib/format";
import { useReportBusy } from "../hooks/usePageActive";
import { useJobResume } from "../hooks/useJobResume";
import ProgressBar from "./ProgressBar";

type Busy = null | "analyze" | "winsxs" | "winold";

function freedText(r: SystemCleanReport, what: "winsxs" | "winold"): string {
  const secs = Math.max(1, Math.round(r.durationMs / 1000));
  const reboot = r.rebootRequired ? " A restart is required to finish." : "";
  if (!r.nothingFreed) return `Finished in ${secs}s — freed about ${formatBytes(r.freedBytes)}.${reboot}`;
  if (what === "winsxs") {
    // DISM trả "thành công" ngay cả khi không còn gì để dọn (vd. vừa dọn xong lần trước).
    if (r.rebootRequired)
      return `Finished in ${secs}s — nothing could be cleaned because Windows is waiting for a restart to finish an update. Restart your PC (do not shut it down), then try again.`;
    return (
      `Finished in ${secs}s — there is nothing else to clean right now. ` +
      'Analysis may still report "reclaimable packages": these are components Windows is retaining, and cleaning them again will not help. ' +
      "PC Manager will not recommend cleaning WinSxS again until a new Windows update is available."
    );
  }
  return `Finished in ${secs}s — no increase in free space was detected.${reboot}`;
}

/** Kết quả DISM /AnalyzeComponentStore: tách phần không dọn được khỏi phần dọn được. */
function AnalysisView({ a }: { a: WinSxsAnalysis }) {
  if (a.actualSize == null) {
    // DISM không trả về định dạng mong đợi — hiện nguyên văn.
    return <pre className="mt-1 whitespace-pre-wrap text-xs opacity-70">{a.raw}</pre>;
  }
  const row = (label: string, value: string | null, note: string, tone = "") =>
    value != null && (
      <div className="flex items-baseline gap-2">
        <span className="w-48 shrink-0 opacity-70">{label}</span>
        <b className={`w-20 shrink-0 text-right tabular-nums ${tone}`}>{value}</b>
        <span className="opacity-60">{note}</span>
      </div>
    );
  return (
    <div className="mt-2 grid gap-0.5 text-xs">
      {row("Total WinSxS store", a.actualSize, "")}
      {row("├ Shared with Windows", a.sharedWithWindows, "files currently used by Windows — cannot be cleaned", "opacity-60")}
      {row("├ Backups and disabled features", a.backups, "partially cleanable (older versions have been replaced)")}
      {row("└ Cache and temporary data", a.cache, "cleanable")}
      <div className="mt-1">
        {a.verdict === "recommended" ? (
          <b className="text-amber-700 dark:text-amber-300">Cleanup recommended</b>
        ) : a.verdict === "pendingRestart" ? (
          <b className="text-amber-700 dark:text-amber-300">Restart first</b>
        ) : (
          <span className="text-green-700 dark:text-green-400">No cleanup needed</span>
        )}
        {a.reclaimablePackages != null && ` · DISM reports ${a.reclaimablePackages} reclaimable packages`}
        {a.lastCleanup && <span className="opacity-60"> · last cleanup: {a.lastCleanup}</span>}
      </div>
      {a.verdict === "pendingRestart" && (
        <p className="opacity-70">
          Windows is waiting for a restart to finish an update — DISM can clean very little while this is pending. Restart your PC (do not shut it down), then analyze again.
        </p>
      )}
      {a.verdict === "afterRestart" && (
        <p className="opacity-70">
          Cleanup has already run since the last restart. The remaining components reported by DISM can only be cleaned after another restart — running cleanup now will not free more space.
        </p>
      )}
      {a.verdict === "stuck" && (
        <p className="opacity-70">
          DISM still recommends cleanup, but the previous cleanup freed no space: Windows is retaining the remaining packages (usually the original update), so running cleanup again will not help. PC Manager will recommend it again after a new Windows update.
        </p>
      )}
    </div>
  );
}

/**
 * Dọn sâu hệ thống bằng công cụ chính thức của Windows:
 * WinSxS qua DISM, Windows.old qua Disk Cleanup. Cần quyền Administrator.
 */
export default function SystemDeepClean() {
  const { elevated } = useElevation();
  const [busy, setBusy] = useState<Busy>(null);
  useReportBusy(busy !== null);
  const [progress, setProgress] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<WinSxsAnalysis | null>(null);
  const [winOld, setWinOld] = useState<WindowsOldInfo | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    api.systemWindowsOldInfo().then(setWinOld).catch(() => setWinOld(null));
  }, []);

  const locked = elevated !== true || busy !== null;

  const analyze = async () => {
    setBusy("analyze");
    setProgress(0);
    // Giữ thông báo kết quả dọn (nếu có); chỉ xoá thông báo lỗi cũ.
    setMsg((m) => (m?.tone === "error" ? null : m));
    try {
      setAnalysis(await api.systemAnalyzeWinsxs(setProgress));
    } catch (e) {
      setMsg({ tone: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const cleanWinsxs = () =>
    setConfirm({
      title: "Clean WinSxS with DISM?",
      body: (
        <div className="space-y-2">
          <p>
            Run <code>DISM /StartComponentCleanup</code> to remove older versions of Windows components replaced by newer updates. This usually takes 5–20 minutes and <b>cannot be interrupted</b>.
          </p>
          <p>
            This usually frees a few hundred MB to a few GB. Most of the WinSxS store consists of files Windows is using ("Shared with Windows") and cannot be cleaned.
          </p>
          <p className="text-xs opacity-70">/ResetBase is not used, so installed updates can still be uninstalled as usual.</p>
        </div>
      ),
      confirmLabel: "Start cleanup",
      onConfirm: async () => {
        setBusy("winsxs");
        setProgress(0);
        setMsg(null);
        try {
          afterWinsxsClean(await api.systemCleanWinsxs(setProgress));
        } catch (e) {
          setMsg({ tone: "error", text: `WinSxS: ${errorMessage(e)}` });
        } finally {
          setBusy(null);
          setProgress(null);
        }
      },
    });

  /**
   * Dọn xong: báo kết quả, ẩn bảng phân tích cũ (đã sai sau khi dọn). Không tự phân tích lại
   * (mất ~1 phút) — người dùng tự bấm "Phân tích" khi muốn xem kho sau khi dọn.
   */
  const afterWinsxsClean = (r: SystemCleanReport) => {
    setMsg({ tone: "ok", text: `WinSxS: ${freedText(r, "winsxs")}` });
    setAnalysis(null);
    setProgress(null);
  };

  // Cửa sổ bị đóng (xuống tray) lúc DISM / Disk Cleanup đang chạy rồi mở lại: hiện lại trạng thái.
  useJobResume<number>("winsxs.analyze", {
    onRunning: (p) => {
      setMsg(null);
      setBusy("analyze");
      setProgress(p ?? 0);
    },
    onProgress: setProgress,
    onDone: (o) => {
      setBusy(null);
      setProgress(null);
      if (o.ok) setAnalysis(o.value as WinSxsAnalysis);
      else setMsg({ tone: "error", text: `WinSxS analysis: ${errorMessage(o.value)}` });
    },
  });
  useJobResume<number>("winsxs.clean", {
    onRunning: (p) => {
      setMsg(null);
      setBusy("winsxs");
      setProgress(p ?? 0);
    },
    onProgress: setProgress,
    onDone: (o) => {
      setProgress(null);
      setBusy(null);
      if (o.ok) afterWinsxsClean(o.value as SystemCleanReport);
      else setMsg({ tone: "error", text: `WinSxS: ${errorMessage(o.value)}` });
    },
  });
  useJobResume<number>("winold.clean", {
    onRunning: (p) => {
      setMsg(null);
      setBusy("winold");
      setProgress(p ?? 0);
    },
    onProgress: setProgress,
    onDone: (o) => {
      setBusy(null);
      setProgress(null);
      setMsg(
        o.ok
          ? { tone: "ok", text: `Windows.old: ${freedText(o.value as SystemCleanReport, "winold")}` }
          : { tone: "error", text: `Windows.old: ${errorMessage(o.value)}` },
      );
      api.systemWindowsOldInfo().then(setWinOld).catch(() => {});
    },
  });

  const cleanWinOld = () =>
    setConfirm({
      title: "Remove the previous Windows installation (Windows.old)?",
      body: (
        <div className="space-y-2">
          <p>
            After removal, you <b>cannot go back to the previous version of Windows</b> (Settings → Recovery → Go back). Any personal files left in
            Windows.old will also be deleted — check them first if needed.
          </p>
          <p className="text-xs opacity-70">PC Manager uses Windows Disk Cleanup (with only "Previous Windows installation" selected).</p>
        </div>
      ),
      confirmLabel: "Remove Windows.old",
      danger: true,
      onConfirm: async () => {
        setBusy("winold");
        setProgress(0);
        setMsg(null);
        try {
          const r = await api.systemCleanWindowsOld(setProgress);
          setMsg({ tone: "ok", text: `Windows.old: ${freedText(r, "winold")}` });
          setWinOld(await api.systemWindowsOldInfo());
        } catch (e) {
          setMsg({ tone: "error", text: `Windows.old: ${errorMessage(e)}` });
        } finally {
          setBusy(null);
          setProgress(null);
        }
      },
    });

  return (
    <Card title="System cleanup" className="mt-4">
      <div className="grid gap-3">
        <AdminNotice>System cleanup requires administrator privileges.</AdminNotice>

        <div className={`flex flex-wrap items-start justify-between gap-3 p-3 ${PANEL}`}>
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium">Windows component store (WinSxS)</div>
            <div className="text-xs opacity-70">
              Clean with DISM — the only safe method. Never delete files directly from WinSxS.
            </div>
            {analysis && <AnalysisView a={analysis} />}
            {busy === "winsxs" && <ProgressBar className="mt-2" pct={progress} label="Cleaning with DISM — do not turn off your PC." />}
            {busy === "analyze" && <ProgressBar className="mt-2" pct={progress} label="Analyzing the WinSxS store (read-only)…" />}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={locked} loading={busy === "analyze"} onClick={analyze} title="DISM /AnalyzeComponentStore — read-only, ~1 minute">
              Analyze
            </Button>
            <Button size="sm" disabled={locked} loading={busy === "winsxs"} onClick={cleanWinsxs}>
              Clean WinSxS
            </Button>
          </div>
        </div>

        <div className={`flex flex-wrap items-start justify-between gap-3 p-3 ${PANEL}`}>
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium">Previous Windows installation (Windows.old)</div>
            <div className="text-xs opacity-70">
              {winOld == null ? (
                <span className="inline-flex items-center gap-1">
                  <Spinner className="h-3 w-3" /> Checking…
                </span>
              ) : winOld.exists ? (
                <>
                  {winOld.path} · about <b>{formatBytes(winOld.bytes)}</b>. Created after a Windows upgrade and used to roll back to the previous version.
                </>
              ) : (
                "None — Windows has not been upgraded recently, or it has already been cleaned."
              )}
            </div>
            {busy === "winold" && (
              <ProgressBar className="mt-2" pct={progress} label="Disk Cleanup is removing Windows.old — percentage is estimated from space recovered." />
            )}
          </div>
          <Button variant="danger" size="sm" disabled={locked || !winOld?.exists} loading={busy === "winold"} onClick={cleanWinOld}>
            Remove Windows.old
          </Button>
        </div>

        {msg && (
          <Notice tone={msg.tone} onClose={() => setMsg(null)}>
            {msg.text}
          </Notice>
        )}
      </div>
      <ConfirmDialog req={confirm} onClose={() => setConfirm(null)} />
    </Card>
  );
}
