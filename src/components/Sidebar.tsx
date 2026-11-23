import type { ComponentType } from "react";
import { Spinner } from "./Button";
import { IconActivity, IconChip, IconDisk, IconGrid, IconHome, IconMonitor, IconPower, IconPulse, IconSettings, IconShield, IconSparkle } from "./Icons";
import { ElevateButton, useElevation } from "./Elevation";
import appIcon from "../../app-icon.svg";

export type PageId =
  | "dashboard"
  | "diagnosis"
  | "system"
  | "memory"
  | "cleaner"
  | "processes"
  | "startup"
  | "apps"
  | "disk"
  | "settings";

const ITEMS: { id: PageId; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: "dashboard", label: "Overview", icon: IconHome },
  { id: "diagnosis", label: "Diagnosis", icon: IconPulse },
  { id: "system", label: "System Info", icon: IconMonitor },
  { id: "memory", label: "Memory", icon: IconChip },
  { id: "cleaner", label: "Junk Cleaner", icon: IconSparkle },
  { id: "processes", label: "Processes", icon: IconActivity },
  { id: "startup", label: "Startup", icon: IconPower },
  { id: "apps", label: "Apps", icon: IconGrid },
  { id: "disk", label: "Disks", icon: IconDisk },
  { id: "settings", label: "Settings", icon: IconSettings },
];

interface Props {
  current: PageId;
  onSelect: (id: PageId) => void;
  /** Trang còn tác vụ đang chạy (quét, dọn, gỡ…) — hiện dấu xoay cạnh tên. */
  busy?: PageId[];
}

export default function Sidebar({ current, onSelect, busy = [] }: Props) {
  const { elevated } = useElevation();
  return (
    <nav
      className="m-2 mr-0 flex w-56 shrink-0 flex-col gap-1 rounded-2xl border border-black/5 bg-white/80 p-3
        dark:border-white/[0.06] dark:bg-[#0a0d13]/90"
    >
      <div className="mb-5 flex items-center gap-2 px-3 pt-3">
        {/* The app’s actual icon (app-icon.svg, the source for all app icons); small enough for Vite to inline. */}
        <img src={appIcon} alt="" className="h-7 w-7 shrink-0" draggable={false} />
        <span className="text-[17px] font-semibold tracking-tight">PC Manager</span>
      </div>
      {ITEMS.map((it) => {
        const active = it.id === current;
        const Icon = it.icon;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onSelect(it.id)}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
              active
                ? "bg-accent/10 font-medium text-accent dark:bg-white/10 dark:text-white"
                : "opacity-75 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/[0.06]"
            }`}
          >
            <Icon />
            {it.label}
            {busy.includes(it.id) && (
              <span className="ml-auto" title="Running" aria-label="Running">
                <Spinner />
              </span>
            )}
          </button>
        );
      })}
      {elevated === false && (
        <div className="mt-auto rounded-md bg-amber-100 p-2 text-xs text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
          <div className="mb-2">Running without administrator privileges — some features are limited.</div>
          <ElevateButton label="Run as administrator" />
        </div>
      )}
      {elevated === true && (
        <div className="mt-auto flex items-center gap-2 px-3 pb-1 text-xs opacity-50">
          <IconShield className="h-3.5 w-3.5" /> Administrator
        </div>
      )}
    </nav>
  );
}
