import { useEffect, useRef, useState } from "react";
import PageShell from "../components/PageShell";
import BoostPanel, { MEMORY_SETTINGS_CHANGED } from "../components/BoostPanel";
import UsageChart from "../components/UsageChart";
import { Card, Notice, Stat } from "../components/Card";
import { useMemoryFeed } from "../hooks/useMemoryFeed";
import { api, errorMessage, type MemorySettings, type MemoryStatus } from "../lib/api";
import { formatBytes, pct } from "../lib/format";

/** Thanh ngang chia RAM: đang dùng | modified | standby | free. */
function Composition({ s }: { s: MemoryStatus }) {
  const modified = s.modified ?? 0;
  const standby = s.standby ?? 0;
  const free = s.free ?? 0;
  const inUse = Math.max(0, s.used - modified);
  const parts = [
    { label: "In use", v: inUse, cls: "bg-accent" },
    { label: "Modified", v: modified, cls: "bg-amber-500" },
    { label: "Standby", v: standby, cls: "bg-sky-400" },
    { label: "Free", v: free, cls: "bg-black/10 dark:bg-white/15" },
  ];
  return (
    <div>
      <div className="flex h-5 overflow-hidden rounded">
        {parts.map((p) => (
          <div key={p.label} className={p.cls} style={{ width: `${pct(p.v, s.total)}%` }} title={`${p.label}: ${formatBytes(p.v)}`} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs">
        {parts.map((p) => (
          <span key={p.label} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${p.cls}`} />
            {p.label} {formatBytes(p.v)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function SmartSettings() {
  const [s, setS] = useState<MemorySettings | null>(null);
  /** Bản đang lưu ở backend — thanh trượt chỉ lưu (và ghi nhật ký) khi giá trị thật sự đổi. */
  const stored = useRef<MemorySettings | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .memorySettings()
      .then((v) => {
        stored.current = v;
        setS(v);
      })
      .catch((e) => setErr(errorMessage(e)));
  }, []);

  const save = async (next: MemorySettings) => {
    setS(next);
    const cur = stored.current;
    if (cur && cur.smartThresholdPct === next.smartThresholdPct && cur.smartAuto === next.smartAuto) return;
    setErr(null);
    try {
      const v = await api.setMemorySettings(next);
      stored.current = v;
      setS(v);
      window.dispatchEvent(new Event(MEMORY_SETTINGS_CHANGED));
      setSaved("Saved");
      window.setTimeout(() => setSaved(null), 1500);
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  if (!s) return err ? <Notice tone="error">{err}</Notice> : null;
  return (
    <div className="grid gap-3 text-sm">
      <label className="flex items-center gap-3">
        <span className="w-48">Available RAM threshold</span>
        <input
          type="range"
          min={5}
          max={50}
          value={s.smartThresholdPct}
          onChange={(e) => setS({ ...s, smartThresholdPct: Number(e.target.value) })}
          onPointerUp={() => save(s)}
          onKeyUp={() => save(s)}
          className="flex-1 accent-[var(--color-accent)]"
        />
        <span className="w-12 text-right tabular-nums">{s.smartThresholdPct}%</span>
      </label>
      <label className="flex items-center gap-3">
        <input type="checkbox" checked={s.smartAuto} onChange={(e) => save({ ...s, smartAuto: e.target.checked })} />
        Run Smart Boost automatically in the background (check every 60 seconds, with a 5-minute cooldown)
      </label>
      <p className="text-xs opacity-60">
        Smart Boost only runs when available RAM falls below the threshold. {saved && <b className="text-green-600">{saved}</b>}
      </p>
      {err && <Notice tone="error">{err}</Notice>}
    </div>
  );
}

export default function Memory() {
  const { overview, history, error } = useMemoryFeed();
  const s = overview?.status;

  return (
    <PageShell title="Memory" subtitle="RAM and virtual memory (commit) details">
      {error && <Notice tone="error">{error}</Notice>}
      {s && (
        <div className="grid gap-4">
          <Card title="RAM composition">
            <Composition s={s} />
          </Card>
          <Card>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 2xl:grid-cols-8">
              <Stat label="Total RAM" value={formatBytes(s.total)} />
              <Stat label="In use" value={formatBytes(s.used)} />
              <Stat label="Available" value={formatBytes(s.available)} hint="Free + Standby — available to Windows immediately" />
              <Stat label="Free" value={formatBytes(s.free)} />
              <Stat label="Standby (cache)" value={formatBytes(s.standby)} hint="Cache for recently used files and apps; already included in available memory. Light Boost clears only low-priority cache, while Deep Boost clears it all." />
              <Stat label="Modified" value={formatBytes(s.modified)} hint="Pages waiting to be written to disk — Boost flushes them to make memory available" />
              <Stat label="Commit" value={`${formatBytes(s.commitTotal)} / ${formatBytes(s.commitLimit)}`} />
              <Stat label="System cache" value={formatBytes(s.systemCache)} />
            </div>
          </Card>
          <Card title="RAM usage — last 60 seconds">
            <UsageChart samples={history} minHeight={200} />
          </Card>
          <Card title="Boost">
            <BoostPanel />
          </Card>
          <Card title="Smart Boost">
            <SmartSettings />
          </Card>
        </div>
      )}
    </PageShell>
  );
}
