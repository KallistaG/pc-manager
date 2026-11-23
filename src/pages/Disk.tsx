import { IconCheck, IconWarning, IconX } from "../components/Icons";
import { INPUT, SELECT, SURFACE, THEAD, pill } from "../components/ui";
import { useReportBusy } from "../hooks/usePageActive";
import { useJobResume } from "../hooks/useJobResume";
import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "../components/Button";
import ProgressBar from "../components/ProgressBar";
import { Card, Notice } from "../components/Card";
import ConfirmDialog, { type ConfirmRequest } from "../components/ConfirmDialog";
import PageShell from "../components/PageShell";
import {
  api,
  errorMessage,
  type DiskProgress,
  type DriveInfo,
  type DupScan,
  type FileItem,
  type JobOutcome,
  type LargeScan,
  type RecycleReport,
} from "../lib/api";
import { formatBytes, formatDate, pct } from "../lib/format";

type Tab = "large" | "dup";

const LARGE_MIN = [
  { v: 50 << 20, label: "≥ 50 MB" },
  { v: 100 << 20, label: "≥ 100 MB" },
  { v: 500 << 20, label: "≥ 500 MB" },
  { v: 1024 << 20, label: "≥ 1 GB" },
];
const DUP_MIN = [
  { v: 1 << 20, label: "≥ 1 MB" },
  { v: 10 << 20, label: "≥ 10 MB" },
  { v: 100 << 20, label: "≥ 100 MB" },
];

const KIND_LABEL: Record<DriveInfo["kind"], string> = {
  fixed: "Local drive",
  removable: "Removable drive",
  network: "Network drive",
  cdRom: "CD/DVD",
  ramDisk: "RAM disk",
  unknown: "Other",
};

function DriveCard({ d, selected, onSelect }: { d: DriveInfo; selected: boolean; onSelect: () => void }) {
  const used = d.total - d.free;
  const p = pct(used, d.total);
  const bar = p > 90 ? "bg-red-500" : p > 75 ? "bg-amber-500" : "bg-accent";
  const usable = d.total > 0 && d.kind !== "network" && d.kind !== "cdRom";
  return (
    <button
      type="button"
      disabled={!usable}
      onClick={onSelect}
      className={`rounded-lg bg-white p-4 text-left shadow-sm transition dark:bg-white/5 ${
        selected ? "ring-2 ring-accent" : "hover:ring-1 hover:ring-black/10 dark:hover:ring-white/20"
      } disabled:opacity-50`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">
          {d.root.slice(0, 2)} {d.label && <span className="font-normal opacity-70">{d.label}</span>}
        </span>
        <span className="text-xs opacity-60">
          {KIND_LABEL[d.kind]} {d.fs && `· ${d.fs}`}
        </span>
      </div>
      {d.total > 0 ? (
        <>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
            <div className={`h-full ${bar}`} style={{ width: `${p}%` }} />
          </div>
          <div className="mt-2 text-xs tabular-nums opacity-70">
            Free {formatBytes(d.free)} / {formatBytes(d.total)} · {p.toFixed(0)}% used
          </div>
        </>
      ) : (
        <div className="mt-3 text-xs opacity-60">Could not read drive capacity</div>
      )}
    </button>
  );
}

/** File nên tránh: dữ liệu ứng dụng / ổ đĩa ảo (cảnh báo) hoặc bị chặn. */
const isRisky = (f: FileItem) => !!f.warning || !!f.blocked;

function progressText(p: DiskProgress | null, dup: boolean): string {
  if (!p) return "Starting…";
  const step = (n: number) => (dup ? `Step ${n}/3 — ` : "");
  if (p.phase === "walk") return `${step(1)}Scanning: ${p.files.toLocaleString("en-US")} files · ${formatBytes(p.bytes)}`;
  const what = p.phase === "head" ? `${step(2)}Comparing first 4 KB` : `${step(3)}Hashing full files`;
  return `${what}: ${p.done.toLocaleString("en-US")} / ${p.total.toLocaleString("en-US")} possible duplicates`;
}

/**
 * % của bước hiện tại. Bước duyệt không biết trước tổng: khi quét cả ổ thì ước lượng bằng dung
 * lượng đã dùng của ổ (tối đa 99%); quét một thư mục thì không biết => null (thanh chạy qua lại).
 */
function progressPct(p: DiskProgress | null, root: string, drives: DriveInfo[]): number | null {
  if (!p) return null;
  if (p.phase !== "walk") return p.total > 0 ? (p.done / p.total) * 100 : null;
  const norm = (s: string) => s.replace(/[\\/]+$/, "").toLowerCase();
  const d = drives.find((x) => norm(x.root) === norm(root));
  const used = d ? d.total - d.free : 0;
  return used > 0 ? Math.min(99, (p.bytes / used) * 100) : null;
}

function FileRow({
  f,
  checked,
  onToggle,
  status,
}: {
  f: FileItem;
  checked: boolean;
  onToggle: () => void;
  status?: { ok: boolean; message: string | null };
}) {
  const name = f.path.split("\\").pop() ?? f.path;
  const dir = f.path.slice(0, f.path.length - name.length);
  return (
    <tr className={`border-t border-black/5 dark:border-white/5 ${f.blocked ? "opacity-50" : ""}`}>
      <td className="w-10 px-3 py-1.5">
        <input
          type="checkbox"
          className="accent-[var(--color-accent)]"
          checked={checked}
          disabled={!!f.blocked || status?.ok}
          onChange={onToggle}
          aria-label={f.path}
        />
      </td>
      <td className="px-2 py-1.5" title={f.path}>
        <div className="truncate">
          <span className="font-medium">{name}</span>
          {status && (
            <span className={`ml-2 text-xs ${status.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
              {status.ok ? <IconCheck /> : <IconX />} {status.ok ? "Moved to Recycle Bin" : (status.message ?? "Error")}
            </span>
          )}
        </div>
        <div className="truncate text-xs opacity-60">{dir}</div>
        {(f.blocked || f.warning) && (
          <div className={`truncate text-xs ${f.blocked ? "" : "text-amber-700 dark:text-amber-300"}`}>
            {f.blocked ? (
              `Cannot delete: ${f.blocked}`
            ) : (
              <>
                <IconWarning /> {f.warning}
              </>
            )}
          </div>
        )}
      </td>
      <td className="w-28 px-3 text-right tabular-nums">{formatBytes(f.size)}</td>
      <td className="w-28 px-3 tabular-nums opacity-70">{f.modifiedMs != null ? formatDate(f.modifiedMs) : "—"}</td>
    </tr>
  );
}

export default function Disk() {
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [root, setRoot] = useState<string>("");
  const [tab, setTab] = useState<Tab>("large");
  const [largeMin, setLargeMin] = useState(LARGE_MIN[1].v);
  const [dupMin, setDupMin] = useState(DUP_MIN[0].v);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<DiskProgress | null>(null);
  const [large, setLarge] = useState<LargeScan | null>(null);
  const [dups, setDups] = useState<DupScan | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [report, setReport] = useState<RecycleReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  /** Tiến độ chuyển vào Thùng rác (done/total = số file). */
  const [recycleProgress, setRecycleProgress] = useState<DiskProgress | null>(null);
  useReportBusy(scanning || busy);
  /** Hide risky files (dữ liệu ứng dụng, ổ đĩa ảo, file bị chặn) — mặc định bật. */
  const [safeOnly, setSafeOnly] = useState(true);

  const loadDrives = useCallback(() => {
    api
      .diskDrives()
      .then((d) => {
        setDrives(d);
        setRoot((r) => r || d.find((x) => x.kind === "fixed")?.root || "");
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(loadDrives, [loadDrives]);

  const reset = () => {
    setSelected(new Set());
    setReport(null);
    setError(null);
  };

  const scan = async () => {
    reset();
    setScanning(true);
    setProgress(null);
    try {
      if (tab === "large") setLarge(await api.diskScanLarge(root, largeMin, setProgress));
      else setDups(await api.diskScanDuplicates(root, dupMin, setProgress));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setScanning(false);
    }
  };

  // Cửa sổ bị đóng (xuống tray) lúc đang quét rồi mở lại: backend vẫn quét => hiện lại tiến độ, kết quả.
  const resumeScan = (which: Tab) => ({
    onRunning: (p: DiskProgress | null) => {
      reset();
      setTab(which);
      setScanning(true);
      setProgress(p);
    },
    onProgress: setProgress,
    onDone: (o: JobOutcome) => {
      setScanning(false);
      if (!o.ok) setError(errorMessage(o.value));
      else if (which === "large") setLarge(o.value as LargeScan);
      else setDups(o.value as DupScan);
    },
  });
  useJobResume<DiskProgress>("disk.large", resumeScan("large"));
  useJobResume<DiskProgress>("disk.dups", resumeScan("dup"));

  const applyReport = (r: RecycleReport) => {
    setReport((prev) => (prev ? { ...r, items: [...prev.items.filter((o) => !r.items.some((n) => n.id === o.id)), ...r.items] } : r));
    setSelected(new Set());
    loadDrives();
  };
  // Đóng cửa sổ lúc đang chuyển file vào Thùng rác rồi mở lại: hiện lại tiến độ và kết quả.
  useJobResume<DiskProgress>("disk.recycle", {
    onRunning: (p) => {
      setBusy(true);
      setRecycleProgress(p);
    },
    onProgress: setRecycleProgress,
    onDone: (o) => {
      setBusy(false);
      setRecycleProgress(null);
      if (o.ok) applyReport(o.value as RecycleReport);
      else setError(errorMessage(o.value));
    },
  });

  const current = tab === "large" ? large : dups;
  // Chỉ những gì đang hiện mới được chọn / chuyển vào Thùng rác.
  const visibleLarge = useMemo(() => (large?.files ?? []).filter((f) => !safeOnly || !isRisky(f)), [large, safeOnly]);
  // File trùng: chỉ giữ nhóm có ≥ 2 bản an toàn, và chỉ hiện các bản an toàn đó.
  const visibleGroups = useMemo(
    () =>
      (dups?.groups ?? [])
        .map((g) => (safeOnly ? { ...g, files: g.files.filter((f) => !isRisky(f)) } : g))
        .filter((g) => g.files.length >= 2),
    [dups, safeOnly],
  );
  const hiddenCount =
    tab === "large"
      ? (large?.files.length ?? 0) - visibleLarge.length
      : (dups?.groups.length ?? 0) - visibleGroups.length;
  const allFiles: FileItem[] = useMemo(
    () => (tab === "large" ? visibleLarge : visibleGroups.flatMap((g) => g.files)),
    [tab, visibleLarge, visibleGroups],
  );
  const byId = useMemo(() => new Map(allFiles.map((f) => [f.id, f])), [allFiles]);
  const outcome = (id: number) => report?.items.find((o) => o.id === id);
  const done = (id: number) => outcome(id)?.ok === true;
  // File đã chọn nhưng giờ bị ẩn (vừa bật bộ lọc) thì không tính.
  const chosen = [...selected].map((id) => byId.get(id)).filter((f): f is FileItem => !!f);
  const chosenBytes = chosen.reduce((s, f) => s + f.size, 0);
  const chosenWarn = chosen.filter((f) => f.warning).length;

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // File trùng: chọn tất cả trừ bản đầu (còn lại, không bị chặn) của mỗi nhóm.
  const autoSelectDups = () => {
    const next = new Set<number>();
    for (const g of visibleGroups) {
      const live = g.files.filter((f) => !done(f.id));
      const keep = live.find((f) => !f.warning) ?? live[0];
      for (const f of live) if (f !== keep && !f.blocked) next.add(f.id);
    }
    setSelected(next);
  };

  // Nhóm mà người dùng chọn hết mọi bản còn lại — backend sẽ từ chối, báo trước ở UI.
  const groupsAllSelected =
    tab === "dup" ? visibleGroups.filter((g) => g.files.filter((f) => !done(f.id)).every((f) => selected.has(f.id))).length : 0;

  const recycle = () =>
    setConfirm({
      title: `Move ${chosen.length} file${chosen.length === 1 ? "" : "s"} to the Recycle Bin?`,
      body: (
        <div className="space-y-2">
          <p>
            {formatBytes(chosenBytes)} will be moved to the <b>Recycle Bin</b>, where you can restore them. Disk space is freed only when
            you empty the Recycle Bin.
          </p>
          {chosenWarn > 0 && <p className="text-amber-700 dark:text-amber-300">
              <IconWarning /> {chosenWarn} files contain app data or are on virtual drives.</p>}
          <p className="text-xs opacity-70">Files too large for the Recycle Bin may be permanently deleted after Windows asks for confirmation.</p>
        </div>
      ),
      confirmLabel: "Move to Recycle Bin",
      danger: true,
      onConfirm: async () => {
        if (!current) return;
        setBusy(true);
        setError(null);
        setRecycleProgress(null);
        try {
          applyReport(await api.diskRecycle(current.scanId, chosen.map((f) => f.id), setRecycleProgress));
        } catch (e) {
          setError(errorMessage(e));
        } finally {
          setBusy(false);
          setRecycleProgress(null);
        }
      },
    });

  return (
    <PageShell title="Disks" subtitle="Drive space, large files, and duplicates — deleted files go to the Recycle Bin.">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {drives.map((d) => (
          <DriveCard key={d.root} d={d} selected={root === d.root} onSelect={() => setRoot(d.root)} />
        ))}
      </div>

      <Card className="mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {(["large", "dup"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                disabled={scanning}
                onClick={() => {
                  setTab(t);
                  reset();
                }}
                className={`${pill(tab === t)} disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {t === "large" ? "Large files" : "Duplicates"}
              </button>
            ))}
          </div>
          <input
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            disabled={scanning}
            placeholder="Folder to scan, e.g. C:\Users\…"
            className={`min-w-48 flex-1 ${INPUT}`}
            title="Select a drive above or enter a folder path"
          />
          <select
            value={tab === "large" ? largeMin : dupMin}
            disabled={scanning}
            onChange={(e) => (tab === "large" ? setLargeMin : setDupMin)(Number(e.target.value))}
            className={SELECT}
          >
            {(tab === "large" ? LARGE_MIN : DUP_MIN).map((o) => (
              <option key={o.v} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
          {scanning ? (
            <Button variant="secondary" size="sm" onClick={() => api.diskCancel()}>
              Stop
            </Button>
          ) : (
            <Button size="sm" disabled={!root} onClick={scan}>
              Scan
            </Button>
          )}
        </div>
        {scanning && (
          <ProgressBar className="mt-3" pct={progressPct(progress, root, drives)} label={progressText(progress, tab === "dup")} />
        )}
        {!scanning && current && (
          <div className="mt-3 text-sm opacity-70">
            Scanned {current.scannedFiles.toLocaleString("en-US")} files in {(current.durationMs / 1000).toFixed(1)} seconds
            {current.cancelled && " (stopped early)"}
            {tab === "dup" && dups && ` · ${dups.groups.length} duplicate groups · potentially recoverable: ${formatBytes(dups.wastedBytes)}`}
          </div>
        )}
      </Card>

      {error && (
        <div className="mt-3">
          <Notice tone="error" onClose={() => setError(null)}>{error}</Notice>
        </div>
      )}
      {busy && (
        <Card className="mt-3">
          <div className="flex items-center gap-3">
            <ProgressBar
              className="min-w-0 flex-1"
              pct={recycleProgress && recycleProgress.total > 0 ? (recycleProgress.done / recycleProgress.total) * 100 : null}
              label={
                recycleProgress
                  ? `Moving to Recycle Bin: ${recycleProgress.done.toLocaleString("en-US")} / ${recycleProgress.total.toLocaleString("en-US")} files`
                  : "Moving to Recycle Bin…"
              }
            />
            <Button variant="secondary" size="sm" onClick={() => api.diskCancel()}>
              Stop
            </Button>
          </div>
        </Card>
      )}
      {report && (
        <div className="mt-3">
          <Notice tone={report.failed || report.cancelled ? "warn" : "ok"} onClose={() => setReport(null)}>
            Moved {report.recycled} file(s) ({formatBytes(report.recycledBytes)}) to the Recycle Bin
            {report.failed > 0 && `, ${report.failed} file(s) could not be moved`}
            {report.cancelled && " (stopped early)"}. Empty the Recycle Bin on the Junk Cleaner page to free up disk space.
          </Notice>
        </div>
      )}

      {current && !scanning && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="opacity-70">
              Selected {chosen.length} file(s) · {formatBytes(chosenBytes)}
            </span>
            {tab === "dup" && (
              <Button variant="ghost" size="sm" onClick={autoSelectDups} title="Keep one copy per group (prefer copies outside AppData)">
                Select extra copies
              </Button>
            )}
            <label
              className="flex cursor-pointer items-center gap-2"
              title="Hide AppData files, virtual disks (VHDX…), and system/app installation files to avoid selecting them by mistake"
            >
              <input
                type="checkbox"
                className="accent-[var(--color-accent)]"
                checked={safeOnly}
                onChange={(e) => setSafeOnly(e.target.checked)}
              />
              Hide risky files
              {safeOnly && hiddenCount > 0 && (
                <span className="opacity-60">
                  ({hiddenCount} {tab === "large" ? "files" : "groups"} hidden)
                </span>
              )}
            </label>
            {chosen.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Clear selection
              </Button>
            )}
            <Button
              variant="danger"
              size="sm"
              className="ml-auto"
              loading={busy}
              disabled={chosen.length === 0 || groupsAllSelected > 0}
              onClick={recycle}
            >
              Move to Recycle Bin
            </Button>
          </div>
          {groupsAllSelected > 0 && (
            <div className="mt-2">
              <Notice tone="warn">{groupsAllSelected} groups have every copy selected — leave at least one copy in each group.</Notice>
            </div>
          )}
          <div className={`mt-2 min-h-0 flex-1 overflow-auto ${SURFACE}`}>
            <table className="w-full table-fixed text-sm">
              <thead className={`text-left ${THEAD}`}>
                <tr>
                  <th className="w-10" />
                  <th className="px-2 py-2 font-medium opacity-70">File</th>
                  <th className="w-28 px-3 py-2 text-right font-medium opacity-70">Size</th>
                  <th className="w-28 px-3 py-2 font-medium opacity-70">Modified</th>
                </tr>
              </thead>
              {tab === "large" ? (
                <tbody>
                  {visibleLarge.map((f) => (
                    <FileRow key={f.id} f={f} checked={selected.has(f.id)} onToggle={() => toggle(f.id)} status={outcome(f.id)} />
                  ))}
                  {visibleLarge.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-10 text-center opacity-50">
                        {hiddenCount > 0 ? `No safe files found — hidden ${hiddenCount} risky files` : "No files meet the selected threshold"}
                      </td>
                    </tr>
                  )}
                </tbody>
              ) : (
                visibleGroups.map((g, gi) => (
                  <tbody key={gi} className="border-t-4 border-black/5 dark:border-white/5">
                    <tr className="bg-black/[0.02] text-xs dark:bg-white/[0.03]">
                      <td />
                      <td colSpan={3} className="px-2 py-1 opacity-70">
                        Group {gi + 1}: {g.files.length} copies × {formatBytes(g.size)} — extra space: {formatBytes(g.size * (g.files.length - 1))}
                      </td>
                    </tr>
                    {g.files.map((f) => (
                      <FileRow key={f.id} f={f} checked={selected.has(f.id)} onToggle={() => toggle(f.id)} status={outcome(f.id)} />
                    ))}
                  </tbody>
                ))
              )}
              {tab === "dup" && visibleGroups.length === 0 && (
                <tbody>
                  <tr>
                    <td colSpan={4} className="py-10 text-center opacity-50">
                      {hiddenCount > 0 ? `No safe duplicate groups found — hidden ${hiddenCount} risky groups` : "No duplicate files found"}
                    </td>
                  </tr>
                </tbody>
              )}
            </table>
          </div>
        </>
      )}

      <ConfirmDialog req={confirm} onClose={() => setConfirm(null)} />
    </PageShell>
  );
}
