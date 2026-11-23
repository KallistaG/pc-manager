import { IconCheck, IconRefresh, IconX } from "../components/Icons";
import { INPUT, PANEL, SELECT } from "../components/ui";
import { useCallback, useEffect, useState } from "react";
import Button from "../components/Button";
import { Card, Notice } from "../components/Card";
import PageShell from "../components/PageShell";
import { AdminNotice } from "../components/Elevation";
import { api, errorMessage, type ActionLogEntry, type AppInfo, type GeneralSettings } from "../lib/api";
import { SmartSettings } from "./Memory";
import { UpdateSettings } from "../components/UpdatePanel";
import { useTheme, type ThemePref } from "../lib/theme";

const INTERVALS = [
  { v: 1, label: "Daily" },
  { v: 7, label: "Weekly" },
  { v: 30, label: "Monthly" },
];

function useFlash(): [string | null, (s: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const flash = useCallback((s: string) => {
    setMsg(s);
    window.setTimeout(() => setMsg(null), 1800);
  }, []);
  return [msg, flash];
}

function AutoCleanSettings({ s, onChange }: { s: GeneralSettings; onChange: (s: GeneralSettings) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [saved, flash] = useFlash();
  const a = s.autoClean;

  const save = async (enabled: boolean, intervalDays: number, ruleIds: string[]) => {
    setErr(null);
    try {
      const next = await api.settingsSetAutoClean(enabled, intervalDays, ruleIds);
      onChange({ ...s, autoClean: next });
      flash("Saved");
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  const toggleRule = (id: string) =>
    save(a.enabled, a.intervalDays, a.ruleIds.includes(id) ? a.ruleIds.filter((r) => r !== id) : [...a.ruleIds, id]);

  return (
    <div className="grid gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            className="accent-[var(--color-accent)]"
            checked={a.enabled}
            disabled={a.ruleIds.length === 0 && !a.enabled}
            onChange={(e) => save(e.target.checked, a.intervalDays, a.ruleIds)}
          />
          Clean up junk automatically
        </label>
        <select
          value={a.intervalDays}
          onChange={(e) => save(a.enabled, Number(e.target.value), a.ruleIds)}
          className={SELECT}
        >
          {INTERVALS.map((i) => (
            <option key={i.v} value={i.v}>
              {i.label}
            </option>
          ))}
        </select>
        <span className="text-xs opacity-60">
          Last run: {a.lastRunMs != null ? new Date(a.lastRunMs).toLocaleString("en-US") : "Never"}
        </span>
        {saved && <b className="text-xs text-green-600">{saved}</b>}
      </div>
      <div className="grid gap-1 sm:grid-cols-2">
        {s.autoRules.map((r) => (
          <label key={r.id} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 hover:bg-black/5 dark:hover:bg-white/5" title={r.description}>
            <input type="checkbox" className="mt-0.5 accent-[var(--color-accent)]" checked={a.ruleIds.includes(r.id)} onChange={() => toggleRule(r.id)} />
            <span>
              {r.name}
              <span className="block text-xs opacity-60">{r.description}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="text-xs opacity-60">
        Only low-risk items can be cleaned automatically (services are never stopped and the Recycle Bin is never emptied). New files, files in use, and protected folders are still skipped. Each run is recorded in the activity log below. To preview a cleanup, use the Junk Cleaner page.
      </p>
      {err && <Notice tone="error">{err}</Notice>}
    </div>
  );
}

function WhitelistSettings({ s, onChange }: { s: GeneralSettings; onChange: (s: GeneralSettings) => void }) {
  const [input, setInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saved, flash] = useFlash();

  const save = async (paths: string[]) => {
    setErr(null);
    try {
      const list = await api.settingsSetWhitelist(paths);
      onChange({ ...s, whitelist: list });
      setInput("");
      flash("Saved");
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  return (
    <div className="grid gap-3 text-sm">
      <p className="text-xs opacity-60">
        PC Manager will <b>never</b> delete anything in these folders — this applies to Junk Cleaner, Disks, and leftover cleanup.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) save([...s.whitelist, input.trim()]);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. D:\Projects or C:\Users\…\AppData\Local\MyApp"
          className={`flex-1 ${INPUT}`}
        />
        <Button size="sm" type="submit" disabled={!input.trim()}>
          Add
        </Button>
      </form>
      {s.whitelist.length === 0 ? (
        <div className="text-xs opacity-50">No folders added.</div>
      ) : (
        <ul className={`divide-y divide-black/5 dark:divide-white/5 ${PANEL}`}>
          {s.whitelist.map((p) => (
            <li key={p} className="flex items-center gap-2 px-3 py-1.5">
              <span className="flex-1 truncate font-mono text-xs" title={p}>
                {p}
              </span>
              <Button variant="ghost" size="sm" onClick={() => save(s.whitelist.filter((x) => x !== p))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {saved && <b className="text-xs text-green-600">{saved}</b>}
      {err && <Notice tone="error">{err}</Notice>}
    </div>
  );
}

function AutostartSettings({ s, onChange }: { s: GeneralSettings; onChange: (s: GeneralSettings) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = async (enabled: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      onChange({ ...s, autostart: await api.settingsSetAutostart(enabled) });
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-2 text-sm">
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          className="accent-[var(--color-accent)]"
          checked={s.autostart}
          // Disabling is always allowed; enabling is only allowed when installed in Program Files.
          disabled={busy || !s.elevated || (!s.autostart && !!s.autostartBlocked)}
          onChange={(e) => set(e.target.checked)}
        />
        Start with Windows (run minimized to the system tray)
      </label>
      <p className="text-xs opacity-60">
        Uses Task Scheduler with the highest privileges. Since PC Manager requires administrator privileges, a regular Run entry would be blocked by UAC. The app runs as an administrator without prompting, so this option is only available when PC Manager is installed in Program Files (where only administrators can modify files).
      </p>
      {!s.elevated && <AdminNotice>Administrator privileges are required to change this setting.</AdminNotice>}
      {s.elevated && s.autostartBlocked && <Notice tone="warn">{s.autostartBlocked}</Notice>}
      {err && <Notice tone="error">{err}</Notice>}
    </div>
  );
}

function ActivityLog() {
  const [items, setItems] = useState<ActionLogEntry[] | null>(null);
  const load = useCallback(() => {
    api.recentActions(100).then(setItems).catch(() => setItems([]));
  }, []);
  useEffect(load, [load]);
  return (
    <div className="text-sm">
      <div className="mb-2 flex justify-end">
        <Button variant="ghost" size="sm" onClick={load}>
          <IconRefresh /> Refresh
        </Button>
      </div>
      <div className={`max-h-80 overflow-auto ${PANEL}`}>
        <table className="w-full table-fixed text-xs">
          <tbody>
            {(items ?? []).map((a, i) => (
              <tr key={i} className="border-t border-black/5 first:border-t-0 dark:border-white/5" title={a.detail}>
                <td className="w-36 px-3 py-1 tabular-nums opacity-60">{new Date(a.ts).toLocaleString("en-US")}</td>
                <td className="w-44 px-2 py-1 font-mono">{a.action}</td>
                <td className="truncate px-2 py-1">{a.target}</td>
                <td className={`w-10 px-2 py-1 ${a.ok ? "text-green-600" : "text-red-600"}`}>{a.ok ? <IconCheck /> : <IconX />}</td>
              </tr>
            ))}
            {items?.length === 0 && (
              <tr>
                <td className="px-3 py-6 text-center opacity-50">No activity yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const THEMES: { id: ThemePref; label: string }[] = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "system", label: "Follow Windows" },
];

function ThemeSettings() {
  const [pref, setPref] = useTheme();
  return (
    <div className="grid gap-2 text-sm">
      <div className="inline-flex w-fit rounded-lg bg-black/5 p-1 dark:bg-white/5" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={pref === t.id}
            onClick={() => setPref(t.id)}
            className={`rounded-md px-3 py-1.5 transition ${pref === t.id ? "bg-white shadow-sm dark:bg-white/15" : "opacity-70 hover:opacity-100"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-xs opacity-60">Changes the appearance only and does not affect app performance.</p>
    </div>
  );
}

export default function Settings() {
  const [s, setS] = useState<GeneralSettings | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.settingsGet().then(setS).catch((e) => setErr(errorMessage(e)));
    api.appInfo().then(setInfo).catch(() => {});
  }, []);

  return (
    <PageShell title="Settings" subtitle="Smart Boost, automatic cleanup, startup, updates, and protected folders.">
      {err && <Notice tone="error">{err}</Notice>}
      {/*
        Two columns with equal-height cards in each row (the default grid stretch behavior): group similarly sized cards together; larger cards (allowlist, activity log) span both columns.
      */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Theme">
          <ThemeSettings />
        </Card>
        <Card title="Startup">{s && <AutostartSettings s={s} onChange={setS} />}</Card>
        <Card title="Smart Boost">
          <SmartSettings />
        </Card>
        <Card title="Automatic cleanup schedule">{s && <AutoCleanSettings s={s} onChange={setS} />}</Card>
        <Card title="Updates" className="xl:col-span-2">
          <UpdateSettings />
        </Card>
        <Card title="Protected folders (allowlist)" className="xl:col-span-2">
          {s && <WhitelistSettings s={s} onChange={setS} />}
        </Card>
        <Card title="Activity log" className="xl:col-span-2">
          <ActivityLog />
        </Card>
      </div>
      {info && (
        <p className="mt-4 text-xs opacity-50">
          PC Manager {info.version} · PID {info.pid} · {info.isElevated ? "running as administrator" : "not running as administrator"}
        </p>
      )}
    </PageShell>
  );
}
