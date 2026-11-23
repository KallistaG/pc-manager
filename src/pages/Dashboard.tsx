import PageShell from "../components/PageShell";
import ArcGauge from "../components/ArcGauge";
import Button from "../components/Button";
import { useNavigate } from "../hooks/useNavigate";
import BoostPanel from "../components/BoostPanel";
import UsageChart from "../components/UsageChart";
import { Card, Notice, Stat } from "../components/Card";
import { useMemoryFeed } from "../hooks/useMemoryFeed";
import { formatBytes, pct } from "../lib/format";


export default function Dashboard() {
  const { overview, history, error } = useMemoryFeed();
  const s = overview?.status;
  const navigate = useNavigate();

  return (
    <PageShell title="Overview" subtitle="Memory status, updated every 2 seconds while the window is open">
      {error && (
        <div className="mb-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {/* The top row expands with the window; the Boost row keeps its natural height. */}
      <div className="grid min-h-[240px] flex-1 gap-4 md:grid-cols-[auto_1fr] 2xl:gap-6">
        <Card title="RAM" className="flex flex-col">
          <div className="flex flex-1 items-center justify-center gap-6 xl:gap-8 2xl:gap-12">
            <ArcGauge value={s ? pct(s.used, s.total) : null} label="RAM in use" className="w-48 xl:w-60 2xl:w-72" />
            <div className="grid gap-2 2xl:gap-4">
              <Stat label="In use" value={formatBytes(s?.used)} />
              <Stat label="Available" value={formatBytes(s?.available)} />
              <Stat label="Total" value={formatBytes(s?.total)} />
            </div>
          </div>
        </Card>
        <Card title="Last 60 seconds" className="flex min-w-0 flex-col">
          <UsageChart samples={history} minHeight={160} />
        </Card>
      </div>
      <Card className="mt-4 flex shrink-0 flex-wrap items-center justify-between gap-3 2xl:mt-6">
        <div className="min-w-0">
          <div className="font-medium">Smart diagnosis</div>
          <div className="text-sm opacity-60">Check memory, disks, junk files, startup apps, Windows, and hardware in one read-only scan — it only takes a few seconds.</div>
        </div>
        <Button variant="primary" onClick={() => navigate("diagnosis")}>
          Diagnose PC
        </Button>
      </Card>
      <Card title="Boost" className="mt-4 shrink-0 2xl:mt-6">
        <BoostPanel />
      </Card>
    </PageShell>
  );
}
