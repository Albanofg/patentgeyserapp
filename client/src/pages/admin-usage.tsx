import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Download, Filter, RefreshCw } from "lucide-react";

interface UsageRow {
  id: string;
  userId: string | null;
  userEmail: string | null;
  projectId: string | null;
  agentLabel: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  totalTokens: number | null;
  durationMs: number | null;
  status: string;
  fallbackFrom: string | null;
  usedSecondaryKey: boolean | null;
  requestId: string | null;
  errorMessage: string | null;
  createdAt: string;
}

interface UsageResponse {
  window: { from: string; to: string };
  summary: {
    totalCalls: number;
    totalInput: number | string;
    totalOutput: number | string;
    totalCached: number | string;
    totalTokens: number | string;
    totalDurationMs: number | string;
  };
  byModel: Array<{ model: string; calls: number; inputTokens: number | string; outputTokens: number | string; totalTokens: number | string }>;
  byAgent: Array<{ agentLabel: string; calls: number; totalTokens: number | string }>;
  byUser: Array<{ userEmail: string | null; calls: number; totalTokens: number | string }>;
  rows: UsageRow[];
  pagination: { limit: number; offset: number; returned: number };
}

type Preset = "today" | "7d" | "30d" | "all";

function presetRange(p: Preset): { from?: string; to?: string } {
  const now = new Date();
  if (p === "all") return {};
  const to = now.toISOString();
  const from = new Date(now);
  if (p === "today") from.setHours(0, 0, 0, 0);
  if (p === "7d") from.setDate(now.getDate() - 7);
  if (p === "30d") from.setDate(now.getDate() - 30);
  return { from: from.toISOString(), to };
}

function fmtNum(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString();
}

function fmtDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    ok: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30",
    retry: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    fallback: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
    error: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  };
  return (
    <Badge variant="outline" className={map[status] ?? ""}>
      {status}
    </Badge>
  );
}

export default function AdminUsage() {
  const [preset, setPreset] = useState<Preset>("7d");
  const [userEmail, setUserEmail] = useState("");
  const [agentLabel, setAgentLabel] = useState("");
  const [model, setModel] = useState("");
  const [status, setStatus] = useState("");

  const params = useMemo(() => {
    const p = new URLSearchParams();
    const range = presetRange(preset);
    if (range.from) p.set("from", range.from);
    if (range.to) p.set("to", range.to);
    if (userEmail) p.set("userEmail", userEmail);
    if (agentLabel) p.set("agentLabel", agentLabel);
    if (model) p.set("model", model);
    if (status) p.set("status", status);
    return p;
  }, [preset, userEmail, agentLabel, model, status]);

  const url = `/api/admin/usage?${params.toString()}`;
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<UsageResponse>({
    queryKey: [url],
    retry: false,
  });

  const exportUrl = `/api/admin/usage/export?${params.toString()}`;

  const clearFilters = () => {
    setUserEmail("");
    setAgentLabel("");
    setModel("");
    setStatus("");
  };

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">AI Usage</h1>
          <p className="text-sm text-muted-foreground">
            Every server-side AI call across the app, per user, per agent, per model.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <a href={exportUrl} download>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
          </a>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Filters</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(["today", "7d", "30d", "all"] as const).map((p) => (
              <Button
                key={p}
                size="sm"
                variant={preset === p ? "default" : "outline"}
                onClick={() => setPreset(p)}
              >
                {p === "today" ? "Today" : p === "7d" ? "Last 7 days" : p === "30d" ? "Last 30 days" : "All time"}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <Input
              placeholder="User email"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
            />
            <Input
              placeholder="Agent (e.g. AI Helper)"
              value={agentLabel}
              onChange={(e) => setAgentLabel(e.target.value)}
            />
            <Input
              placeholder="Model (e.g. gemini-pro-latest)"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <Input
              placeholder="Status (ok / retry / fallback / error)"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            />
          </div>
          {(userEmail || agentLabel || model || status) && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">
            Failed to load: {(error as any)?.message ?? "unknown error"}
          </CardContent>
        </Card>
      ) : data ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <SummaryCard label="Calls" value={fmtNum(data.summary.totalCalls)} />
            <SummaryCard label="Input tokens" value={fmtNum(data.summary.totalInput)} />
            <SummaryCard label="Output tokens" value={fmtNum(data.summary.totalOutput)} />
            <SummaryCard label="Cached tokens" value={fmtNum(data.summary.totalCached)} />
            <SummaryCard label="Total tokens" value={fmtNum(data.summary.totalTokens)} />
          </div>

          {/* Breakdowns */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <BreakdownCard
              title="By model"
              description="Calls and tokens by model"
              rows={data.byModel.map((m) => ({
                label: m.model,
                count: m.calls,
                tokens: m.totalTokens,
              }))}
            />
            <BreakdownCard
              title="By agent"
              description="Stage / agent activity"
              rows={data.byAgent.map((a) => ({
                label: a.agentLabel,
                count: a.calls,
                tokens: a.totalTokens,
              }))}
            />
            <BreakdownCard
              title="By user"
              description="Per-user token spend"
              rows={data.byUser.map((u) => ({
                label: u.userEmail ?? "(unattributed)",
                count: u.calls,
                tokens: u.totalTokens,
              }))}
            />
          </div>

          {/* Main table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Recent calls
                <span className="text-xs font-normal text-muted-foreground ml-2">
                  showing {data.rows.length} of up to {data.pagination.limit}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="py-2 pr-3 font-medium">When</th>
                    <th className="py-2 pr-3 font-medium">User</th>
                    <th className="py-2 pr-3 font-medium">Agent</th>
                    <th className="py-2 pr-3 font-medium">Model</th>
                    <th className="py-2 pr-3 font-medium text-right">In</th>
                    <th className="py-2 pr-3 font-medium text-right">Out</th>
                    <th className="py-2 pr-3 font-medium text-right">Total</th>
                    <th className="py-2 pr-3 font-medium text-right">Time</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap">{fmtTime(r.createdAt)}</td>
                      <td className="py-2 pr-3">
                        <div className="truncate max-w-[180px]" title={r.userEmail ?? r.userId ?? ""}>
                          {r.userEmail ?? <span className="text-muted-foreground italic">unattributed</span>}
                        </div>
                        {r.projectId ? (
                          <div className="text-xs text-muted-foreground truncate max-w-[180px]" title={r.projectId}>
                            project: {r.projectId.slice(0, 8)}…
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3">{r.agentLabel}</td>
                      <td className="py-2 pr-3">
                        {r.model}
                        {r.fallbackFrom ? (
                          <div className="text-xs text-muted-foreground">from: {r.fallbackFrom}</div>
                        ) : null}
                        {r.usedSecondaryKey ? (
                          <div className="text-xs text-muted-foreground">secondary key</div>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(r.inputTokens)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(r.outputTokens)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(r.totalTokens)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtDuration(r.durationMs)}</td>
                      <td className="py-2 pr-3">
                        {statusBadge(r.status)}
                        {r.errorMessage ? (
                          <div className="text-xs text-muted-foreground mt-1 truncate max-w-[240px]" title={r.errorMessage}>
                            {r.errorMessage}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {data.rows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center py-8 text-muted-foreground text-sm">
                        No calls in this window.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function BreakdownCard({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: Array<{ label: string; count: number; tokens: number | string }>;
}) {
  const sorted = [...rows].sort((a, b) => Number(b.tokens) - Number(a.tokens));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <div className="text-xs text-muted-foreground">No data.</div>
        ) : (
          <ul className="space-y-1 text-sm">
            {sorted.slice(0, 8).map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="truncate" title={r.label}>{r.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                  {r.count} · {fmtNum(r.tokens)} tok
                </span>
              </li>
            ))}
            {sorted.length > 8 ? (
              <li className="text-xs text-muted-foreground italic">
                + {sorted.length - 8} more
              </li>
            ) : null}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
