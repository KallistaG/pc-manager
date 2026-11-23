import { INPUT, SELECT, SURFACE, THEAD } from "../components/ui";
import { memo, useCallback, useMemo, useState } from "react";
import { AdminNotice } from "../components/Elevation";
import Button from "../components/Button";
import ConfirmDialog, { type ConfirmRequest } from "../components/ConfirmDialog";
import { Notice } from "../components/Card";
import { IconChevron, IconLock } from "../components/Icons";
import PageShell from "../components/PageShell";
import PublisherCell from "../components/PublisherCell";
import { useVisibleInterval } from "../hooks/useWindowVisible";
import { api, errorMessage, type PriorityClass, type ProcessInfo, type ProcessSnapshot, type Publisher } from "../lib/api";
import { formatBytes } from "../lib/format";
import { groupByName, matches, procKey, sortRows, type Group, type Sort, type SortKey } from "../lib/processTable";

type Action = "open" | "trim" | "priority" | "suspend" | "resume" | "kill" | "killGroup";

const PRIORITY_LABEL: Record<PriorityClass, string> = {
  idle: "Idle",
  belowNormal: "Below normal",
  normal: "Normal",
  aboveNormal: "Above normal",
  high: "High",
};

const samePublisher = (a: Publisher, b: Publisher) =>
  a.status === b.status && (a.status !== "signed" || b.status !== "signed" || a.name === b.name);

/** Dòng chỉ vẽ lại khi thứ hiện ra thay đổi — mỗi lần làm mới (2 giây) dữ liệu là object mới. */
const sameProc = (a: ProcessInfo, b: ProcessInfo) =>
  a.pid === b.pid &&
  a.createTime === b.createTime &&
  a.name === b.name &&
  a.cpuPct.toFixed(1) === b.cpuPct.toFixed(1) &&
  formatBytes(a.privateBytes) === formatBytes(b.privateBytes) &&
  a.suspended === b.suspended &&
  a.protectedReason === b.protectedReason &&
  a.path === b.path &&
  samePublisher(a.publisher, b.publisher);

const ROW = "cursor-pointer border-t border-black/5 dark:border-white/5";
const rowState = (active: boolean) => (active ? "bg-accent/15" : "hover:bg-black/5 dark:hover:bg-white/5");

type Selection = { kind: "proc"; key: string } | { kind: "group"; key: string } | null;

const ProcRow = memo(
  function ProcRow({ p, indent, active, onSelect }: { p: ProcessInfo; indent: boolean; active: boolean; onSelect: (s: Selection) => void }) {
    return (
      <tr onClick={() => onSelect({ kind: "proc", key: procKey(p) })} className={`${ROW} ${rowState(active)}`}>
        <td className={`py-1.5 pr-2 ${indent ? "pl-8" : "pl-3"}`} title={p.protectedReason ?? p.name}>
          <div className="flex min-w-0 items-center gap-1">
            {p.protectedReason && <IconLock className="h-3.5 w-3.5 shrink-0 opacity-60" />}
            <span className="truncate">{p.name}</span>
            {p.suspended && (
              <span className="ml-1 shrink-0 rounded bg-amber-500/20 px-1.5 text-xs text-amber-700 dark:text-amber-300">Suspended</span>
            )}
          </div>
        </td>
        <td className="pr-3 text-right tabular-nums opacity-70">{p.pid}</td>
        <td className="pr-3 text-right tabular-nums">{p.cpuPct.toFixed(1)}%</td>
        <td className="pr-3 text-right tabular-nums">{formatBytes(p.privateBytes)}</td>
        <td className="truncate pr-3">
          <PublisherCell p={p.publisher} />
        </td>
        <td className="truncate pr-3 text-xs opacity-60" title={p.path ?? undefined}>
          {p.path}
        </td>
      </tr>
    );
  },
  (a, b) => a.indent === b.indent && a.active === b.active && a.onSelect === b.onSelect && sameProc(a.p, b.p),
);

const GroupRow = memo(
  function GroupRow({
    g,
    open,
    active,
    onSelect,
    onToggle,
  }: {
    g: Group;
    open: boolean;
    active: boolean;
    onSelect: (s: Selection) => void;
    onToggle: (key: string) => void;
  }) {
    return (
      <tr
        onClick={() => onSelect({ kind: "group", key: g.key })}
        onDoubleClick={() => onToggle(g.key)}
        className={`${ROW} font-medium ${rowState(active)}`}
      >
        <td className="truncate py-1.5 pl-3 pr-2">
          <button
            type="button"
            aria-label={open ? "Collapse" : "Expand"}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(g.key);
            }}
            className="mr-1 inline-flex w-4 justify-center opacity-60"
          >
            <IconChevron open={open} />
          </button>
          {g.name} <span className="font-normal opacity-60">({g.members.length})</span>
        </td>
        <td />
        <td className="pr-3 text-right tabular-nums">{g.cpuPct.toFixed(1)}%</td>
        <td className="pr-3 text-right tabular-nums">{formatBytes(g.privateBytes)}</td>
        <td className="truncate pr-3 font-normal">
          <PublisherCell p={g.publisher} />
        </td>
        <td className="truncate pr-3 text-xs font-normal opacity-60">{g.path}</td>
      </tr>
    );
  },
  (a, b) =>
    a.open === b.open &&
    a.active === b.active &&
    a.onSelect === b.onSelect &&
    a.onToggle === b.onToggle &&
    a.g.key === b.g.key &&
    a.g.name === b.g.name &&
    a.g.members.length === b.g.members.length &&
    a.g.cpuPct.toFixed(1) === b.g.cpuPct.toFixed(1) &&
    formatBytes(a.g.privateBytes) === formatBytes(b.g.privateBytes) &&
    a.g.path === b.g.path &&
    samePublisher(a.g.publisher, b.g.publisher),
);

const COLUMNS: { key: SortKey; label: string; cls: string }[] = [
  { key: "name", label: "Name", cls: "w-[28%] text-left" },
  { key: "pid", label: "PID", cls: "w-20 text-right" },
  { key: "cpu", label: "CPU", cls: "w-20 text-right" },
  { key: "memory", label: "RAM", cls: "w-24 text-right" },
  { key: "publisher", label: "Publisher", cls: "w-48 text-left xl:w-64" },
  { key: "path", label: "Path", cls: "text-left" },
];

export default function Processes() {
  const [snap, setSnap] = useState<ProcessSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [grouped, setGrouped] = useState(true);
  const [sort, setSort] = useState<Sort>({ key: "memory", desc: true });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Selection>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  /** Thao tác đang chạy — để hiện spinner đúng trên nút đó. */
  const [busyAction, setBusyAction] = useState<Action | null>(null);
  const busy = busyAction !== null;

  const refresh = useCallback(() => {
    api
      .processList()
      .then((s) => {
        setSnap(s);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useVisibleInterval(refresh, 2000);

  const filtered = useMemo(() => (snap?.processes ?? []).filter((p) => matches(p, query.trim())), [snap, query]);
  const groups = useMemo(() => sortRows(groupByName(filtered), sort), [filtered, sort]);
  const flat = useMemo(() => sortRows(filtered, sort), [filtered, sort]);

  const selectedProc: ProcessInfo | null =
    sel?.kind === "proc" ? (snap?.processes.find((p) => procKey(p) === sel.key) ?? null) : null;
  const selectedGroup: Group | null = sel?.kind === "group" ? (groups.find((g) => g.key === sel.key) ?? null) : null;

  const run = async (action: Action, label: string, fn: () => Promise<{ trimmedBytes: number | null }>) => {
    setBusyAction(action);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ tone: "ok", text: r.trimmedBytes != null ? `${label}: freed ${formatBytes(r.trimmedBytes)} RAM` : `${label}: done` });
      refresh();
    } catch (e) {
      setMsg({ tone: "error", text: `${label}: ${errorMessage(e)}` });
    } finally {
      setBusyAction(null);
    }
  };

  const ask = (r: ConfirmRequest) => setConfirm(r);

  const killOne = (p: ProcessInfo) =>
    ask({
      title: `End ${p.name}?`,
      body: (
        <>
          PID {p.pid}. Any unsaved data in this app will be lost.
          {p.path && <div className="mt-1 break-all text-xs opacity-70">{p.path}</div>}
        </>
      ),
      confirmLabel: "End process",
      danger: true,
      onConfirm: () => run("kill", `End ${p.name}`, () => api.processKill(p)),
    });

  const killGroup = (g: Group) => {
    const targets = g.members.filter((m) => !m.protectedReason);
    ask({
      title: `End ${targets.length} ${g.name} process${targets.length === 1 ? "" : "es"}?`,
      body: "All windows for this app will close, and any unsaved data will be lost.",
      confirmLabel: "End all",
      danger: true,
      onConfirm: () =>
        run("killGroup", `End ${g.name}`, async () => {
          const results = await Promise.allSettled(targets.map((m) => api.processKill(m)));
          const failed = results.filter((r) => r.status === "rejected").length;
          if (failed) throw new Error(`${failed}/${targets.length} processes could not be ended`);
          return { trimmedBytes: null };
        }),
    });
  };

  const suspend = (p: ProcessInfo) =>
    ask({
      title: `Suspend ${p.name}?`,
      body: "The app will freeze (stop responding) until you resume it. Do not suspend an app that is writing files or downloading data.",
      confirmLabel: "Suspend",
      onConfirm: () => run("suspend", `Suspend ${p.name}`, () => api.processSuspend(p)),
    });

  const trim = (p: ProcessInfo) =>
    ask({
      title: `Trim memory for ${p.name}?`,
      body: "Windows will move this process’s memory to the cache/pagefile. The app may be a little slower the next time you use it.",
      confirmLabel: "Trim memory",
      onConfirm: () => run("trim", `Trim memory for ${p.name}`, () => api.processTrim(p)),
    });

  const setPriority = (p: ProcessInfo, pr: PriorityClass) =>
    ask({
      title: `Change ${p.name} priority?`,
      body: (
        <>
          Change from <b>{p.priority ? PRIORITY_LABEL[p.priority] : "?"}</b> to <b>{PRIORITY_LABEL[pr]}</b>. This change is reset when the app restarts.
          {pr === "high" && <div className="mt-1 text-amber-600">High priority may slow down other apps.</div>}
        </>
      ),
      confirmLabel: "Change",
      onConfirm: () => run("priority", `Change priority for ${p.name}`, () => api.processSetPriority(p, pr)),
    });

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key === "cpu" || key === "memory" }));

  const toggle = useCallback(
    (k: string) =>
      setExpanded((s) => {
        const n = new Set(s);
        if (n.has(k)) n.delete(k);
        else n.add(k);
        return n;
      }),
    [],
  );

  const procRow = (p: ProcessInfo, indent: boolean) => {
    const k = procKey(p);
    return <ProcRow key={k} p={p} indent={indent} active={sel?.kind === "proc" && sel.key === k} onSelect={setSel} />;
  };

  const groupRow = (g: Group) => {
    if (g.members.length === 1) return procRow(g.members[0], false);
    const open = expanded.has(g.key) || query.trim() !== "";
    return [
      <GroupRow
        key={`g:${g.key}`}
        g={g}
        open={open}
        active={sel?.kind === "group" && sel.key === g.key}
        onSelect={setSel}
        onToggle={toggle}
      />,
      ...(open ? sortRows(g.members, sort).map((m) => procRow(m, true)) : []),
    ];
  };

  const p = selectedProc;
  const locked = !!p?.protectedReason;

  return (
    <PageShell
      title="Processes"
      subtitle={snap ? `${snap.processes.length} processes · CPU ${snap.totalCpuPct.toFixed(0)}% · ${snap.cpuCount} logical processors` : "Loading…"}
      actions={
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
            Group by app
          </label>
          <input
            type="search"
            placeholder="Search name, PID, path, or publisher…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={`w-72 xl:w-96 ${INPUT}`}
          />
        </div>
      }
    >
      {/* Actions for the selected row. */}
      <div className={`flex min-h-11 flex-wrap items-center gap-1 px-3 py-1.5 ${SURFACE}`}>
        {p && (
          <>
            <span className="mr-2 max-w-56 truncate text-sm font-medium" title={p.path ?? undefined}>
              {p.name} <span className="font-normal opacity-60">· {p.pid}</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              loading={busyAction === "open"}
              disabled={busy || !p.path}
              onClick={() => run("open", "Open location", () => api.processOpenLocation(p))}
            >
              Open file location
            </Button>
            <Button variant="ghost" size="sm" loading={busyAction === "trim"} disabled={busy || locked} onClick={() => trim(p)}>
              Trim memory
            </Button>
            <select
              value=""
              disabled={busy || locked}
              onChange={(e) => e.target.value && setPriority(p, e.target.value as PriorityClass)}
              className={`${SELECT} disabled:cursor-not-allowed disabled:opacity-45`}
            >
              <option value="">Priority: {p.priority ? PRIORITY_LABEL[p.priority] : "?"}</option>
              {(Object.keys(PRIORITY_LABEL) as PriorityClass[])
                .filter((k) => k !== p.priority)
                .map((k) => (
                  <option key={k} value={k}>
                    → {PRIORITY_LABEL[k]}
                  </option>
                ))}
            </select>
            {p.suspended ? (
              <Button
                variant="ghost"
                size="sm"
                loading={busyAction === "resume"}
                disabled={busy}
                onClick={() => run("resume", `Resume ${p.name}`, () => api.processResume(p))}
              >
                Resume
              </Button>
            ) : (
              <Button variant="ghost" size="sm" loading={busyAction === "suspend"} disabled={busy || locked} onClick={() => suspend(p)}>
                Suspend
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-red-600 dark:text-red-400"
              loading={busyAction === "kill"}
              disabled={busy || locked}
              onClick={() => killOne(p)}
            >
              End process
            </Button>
            {locked && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs opacity-60">
                <IconLock /> {p.protectedReason}
              </span>
            )}
          </>
        )}
        {selectedGroup && (
          <>
            <span className="mr-2 text-sm font-medium">
              {selectedGroup.name} <span className="font-normal opacity-60">· {selectedGroup.members.length} processes</span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => toggle(selectedGroup.key)}>
              {expanded.has(selectedGroup.key) ? "Collapse" : "Show individual processes"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-red-600 dark:text-red-400"
              loading={busyAction === "killGroup"}
              disabled={busy || selectedGroup.members.every((m) => m.protectedReason)}
              onClick={() => killGroup(selectedGroup)}
            >
              End all
            </Button>
          </>
        )}
        {!p && !selectedGroup && <span className="text-sm opacity-50">Select a process to take action</span>}
      </div>

      {msg && (
        <div className="mt-2">
          <Notice tone={msg.tone} onClose={() => setMsg(null)}>{msg.text}</Notice>
        </div>
      )}
      <div className="mt-2 empty:hidden">
        <AdminNotice>System processes and processes owned by other accounts can only be ended, suspended, or reprioritized with administrator privileges.</AdminNotice>
      </div>
      {error && (
        <div className="mt-2">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      <div className={`mt-3 min-h-0 flex-1 overflow-auto ${SURFACE}`}>
        <table className="w-full table-fixed text-sm">
          <thead className={THEAD}>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => onSort(c.key)}
                  className={`cursor-pointer select-none px-3 py-2 font-medium opacity-70 hover:opacity-100 ${c.cls}`}
                >
                  {c.label}
                  {sort.key === c.key && <span className="ml-1">{sort.desc ? "↓" : "↑"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{grouped ? groups.flatMap(groupRow) : flat.map((x) => procRow(x, false))}</tbody>
        </table>
      </div>

      <ConfirmDialog req={confirm} onClose={() => setConfirm(null)} />
    </PageShell>
  );
}
