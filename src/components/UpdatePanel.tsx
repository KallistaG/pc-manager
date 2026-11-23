import { useState } from "react";
import Button from "./Button";
import { Notice } from "./Card";
import ProgressBar from "./ProgressBar";
import { useNavigate } from "../hooks/useNavigate";
import { useUpdate } from "../hooks/useUpdate";
import { formatBytes, formatDate } from "../lib/format";

/** Thẻ "Cập nhật" trong Cài đặt: công tắc tự kiểm tra, nút kiểm tra, cài bản mới. */
export function UpdateSettings() {
  const { info, error, checking, installing, progress, check, setAuto, install } = useUpdate();
  const a = info?.available ?? null;
  const pct = progress?.total ? (progress.downloaded / progress.total) * 100 : null;
  return (
    <div className="grid gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span>
          Current version: <b>{info?.current ?? "…"}</b>
        </span>
        <Button variant="ghost" size="sm" loading={checking} disabled={installing} onClick={() => check(true)}>
          Check for updates
        </Button>
        {info?.lastCheckMs != null && !checking && (
          <span className="text-xs opacity-60">Last checked: {new Date(info.lastCheckMs).toLocaleString("en-US")}</span>
        )}
      </div>
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          className="accent-[var(--color-accent)]"
          checked={info?.auto ?? true}
          disabled={!info}
          onChange={(e) => setAuto(e.target.checked)}
        />
        Automatically check for updates when PC Manager opens (at most once a day)
      </label>
      <p className="text-xs opacity-60">
        PC Manager only requests the latest version from github.com and sends no information about your PC. Updates are never installed automatically: they are downloaded only after you click Update, verified before the installer runs, and Windows will ask for UAC confirmation.
      </p>
      {a && (
        <div className="grid gap-2 rounded-xl border border-accent/40 p-3">
          <div className="font-medium">
            New version available: {a.version}
            {a.dateMs != null && <span className="font-normal opacity-60"> · released {formatDate(a.dateMs)}</span>}
          </div>
          {a.notes && (
            // "Có gì mới" là markdown của CHANGELOG: chỉ làm đậm dòng tiêu đề, phần còn lại hiện như chữ thường.
            <div className="max-h-48 overflow-auto text-xs opacity-80">
              {a.notes.split("\n").map((line, i) => {
                const h = line.match(/^#{1,6}\s+(.*)$/);
                return h ? (
                  <div key={i} className="mt-1 font-semibold first:mt-0">
                    {h[1]}
                  </div>
                ) : (
                  <div key={i} className="whitespace-pre-wrap">
                    {line.replace(/\*\*(.+?)\*\*/g, "$1") || " "}
                  </div>
                );
              })}
            </div>
          )}
          {installing ? (
            <ProgressBar
              pct={pct}
              label={
                progress
                  ? `Downloading ${formatBytes(progress.downloaded)}${progress.total ? ` / ${formatBytes(progress.total)}` : ""} — the installer will run when complete (UAC)`
                  : "Starting download…"
              }
            />
          ) : (
            <div>
              <Button size="sm" disabled={!info?.configured} onClick={install}>
                Update to {a.version}
              </Button>
            </div>
          )}
          {!info?.configured && (
            <Notice tone="warn">This build of PC Manager cannot verify update signatures — download the latest release from GitHub.</Notice>
          )}
        </div>
      )}
      {info && !a && info.lastCheckMs != null && !checking && !error && <p className="text-xs opacity-60">You are using the latest version.</p>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

/** Dải báo bản mới ở đầu cửa sổ (ẩn được trong phiên này). */
export function UpdateBanner() {
  const { info, installing } = useUpdate();
  const navigate = useNavigate();
  const [hidden, setHidden] = useState<string | null>(null);
  const a = info?.available;
  if (!a || hidden === a.version || installing) return null;
  return (
    <div className="mb-4">
      <Notice tone="ok" onClose={() => setHidden(a.version)}>
        <span className="flex flex-wrap items-center gap-2">
          A new version of PC Manager is available: <b>{a.version}</b> (currently using {info?.current}).
          <Button size="sm" variant="ghost" onClick={() => navigate("settings")}>
            View & update
          </Button>
        </span>
      </Notice>
    </div>
  );
}
