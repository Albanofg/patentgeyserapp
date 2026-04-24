import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Users, ShieldCheck, ShieldOff, FolderOpen, PauseCircle, PlayCircle, Mail, Clock } from "lucide-react";

interface PaidAdminUser {
  id: string;
  email: string;
  projectLimit: number;
  projectCount: number;
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string | null;
}

interface ProjectStage {
  stage: number;
  substage: string | null;
}

interface AdminUser {
  id: string;
  email: string;
  twoFactorEnabled: boolean;
  subscriptionStatus: string | null;
  note: string | null;
  projectCount: number;
  lastLoginAt: string | null;
  createdAt: string | null;
  projectStages: ProjectStage[];
}

function stageLabel(stage: number, substage: string | null): string {
  if (stage === 5) return "M5";
  if (substage) return `M${stage}${substage.replace(/^\d+/, "")}`;
  return `M${stage}`;
}

function groupStages(stages: ProjectStage[]): { label: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const p of stages) {
    const label = stageLabel(p.stage, p.substage);
    counts[label] = (counts[label] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, count]) => ({ label, count }));
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function AdminUsers() {
  const { toast } = useToast();

  const { data: users = [], isLoading, isError, refetch } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    retry: false,
  });

  const { data: paidUsers = [], isLoading: paidLoading } = useQuery<PaidAdminUser[]>({
    queryKey: ["/api/admin/paid-users"],
    retry: false,
  });

  const [limitEdits, setLimitEdits] = useState<Record<string, string>>({});

  const limitMutation = useMutation({
    mutationFn: async ({ id, projectLimit }: { id: string; projectLimit: number }) => {
      return await apiRequest("PATCH", `/api/admin/paid-users/${id}/project-limit`, { projectLimit });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/paid-users"] });
      toast({ title: "Project limit updated" });
    },
    onError: () => {
      toast({ title: "Update failed", variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ email, status }: { email: string; status: string }) => {
      return await apiRequest("PATCH", `/api/admin/whitelist/${encodeURIComponent(email)}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Status updated" });
    },
    onError: () => {
      toast({ title: "Update failed", variant: "destructive" });
    },
  });

  const activeCount = users.filter(u => u.subscriptionStatus === "active").length;
  const suspendedCount = users.filter(u => u.subscriptionStatus === "read_only").length;
  const noWhitelistCount = users.filter(u => !u.subscriptionStatus).length;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Registered Users</h1>
        <p className="text-sm text-muted-foreground mt-1">All accounts created in the system</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm text-muted-foreground">Total accounts</p>
                <p className="text-2xl font-semibold">{users.length}</p>
              </div>
              <Users className="h-8 w-8 text-muted-foreground/40" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm text-muted-foreground">Active subscribers</p>
                <p className="text-2xl font-semibold">{activeCount}</p>
              </div>
              <ShieldCheck className="h-8 w-8 text-muted-foreground/40" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm text-muted-foreground">Suspended / no access</p>
                <p className="text-2xl font-semibold">{suspendedCount + noWhitelistCount}</p>
              </div>
              <ShieldOff className="h-8 w-8 text-muted-foreground/40" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* User table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">All accounts</CardTitle>
          <CardDescription>Click the toggle to suspend or reactivate a user's subscription.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <ShieldOff className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">You don't have permission to view this page, or your session expired.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button>
            </div>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No users found.</p>
          ) : (
            <div className="space-y-2">
              {users.map((user) => (
                <div
                  key={user.id}
                  data-testid={`row-user-${user.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" data-testid={`text-email-${user.id}`}>
                        {user.email}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {user.note && (
                          <p className="text-xs text-muted-foreground">{user.note}</p>
                        )}
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Last login: {timeAgo(user.lastLoginAt)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {/* Project stages — grouped */}
                    {(user.projectStages ?? []).length === 0 ? (
                      <Badge variant="outline" className="gap-1 text-muted-foreground">
                        <FolderOpen className="h-3 w-3" />
                        No projects
                      </Badge>
                    ) : (
                      <div className="flex flex-wrap gap-1 items-center">
                        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        {groupStages(user.projectStages ?? []).map(({ label, count }) => (
                          <Badge key={label} variant="secondary" className="text-xs px-1.5 py-0 gap-1">
                            {label}
                            {count > 1 && (
                              <span className="text-muted-foreground font-normal">×{count}</span>
                            )}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* 2FA badge */}
                    {user.twoFactorEnabled ? (
                      <Badge variant="outline" className="gap-1 text-green-600 border-green-600/30">
                        <ShieldCheck className="h-3 w-3" />
                        2FA on
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 text-muted-foreground">
                        <ShieldOff className="h-3 w-3" />
                        2FA off
                      </Badge>
                    )}

                    {/* Subscription status */}
                    {user.subscriptionStatus === "active" && (
                      <Badge className="bg-green-600/10 text-green-700 border-green-600/20">Active</Badge>
                    )}
                    {user.subscriptionStatus === "read_only" && (
                      <Badge className="bg-yellow-500/10 text-yellow-700 border-yellow-500/20">Suspended</Badge>
                    )}
                    {!user.subscriptionStatus && (
                      <Badge variant="outline" className="text-muted-foreground">Not whitelisted</Badge>
                    )}

                    {/* Toggle button — only if on whitelist */}
                    {user.subscriptionStatus && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={statusMutation.isPending}
                        data-testid={`button-toggle-status-${user.id}`}
                        onClick={() =>
                          statusMutation.mutate({
                            email: user.email,
                            status: user.subscriptionStatus === "active" ? "read_only" : "active",
                          })
                        }
                      >
                        {statusMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : user.subscriptionStatus === "active" ? (
                          <>
                            <PauseCircle className="h-3 w-3 mr-1" />
                            Suspend
                          </>
                        ) : (
                          <>
                            <PlayCircle className="h-3 w-3 mr-1" />
                            Reactivate
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Paid Users (PatentGeyser)</CardTitle>
          <CardDescription>Project creation limit per paid user. Bump this when a GHL purchase is confirmed.</CardDescription>
        </CardHeader>
        <CardContent>
          {paidLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : paidUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No paid users yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-4">Email</th>
                    <th className="py-2 pr-4">Limit</th>
                    <th className="py-2 pr-4">Used</th>
                    <th className="py-2 pr-4">2FA</th>
                    <th className="py-2 pr-4">Last login</th>
                    <th className="py-2 pr-4">Created</th>
                    <th className="py-2 pr-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {paidUsers.map((u) => {
                    const draft = limitEdits[u.id] ?? String(u.projectLimit);
                    const dirty = draft !== String(u.projectLimit);
                    return (
                      <tr key={u.id} className="border-b last:border-0">
                        <td className="py-2 pr-4">{u.email}</td>
                        <td className="py-2 pr-4">
                          <input
                            type="number"
                            min={0}
                            className="w-16 border rounded px-1 py-0.5 text-right bg-background"
                            value={draft}
                            onChange={(e) => setLimitEdits((prev) => ({ ...prev, [u.id]: e.target.value }))}
                          />
                        </td>
                        <td className="py-2 pr-4">{u.projectCount}</td>
                        <td className="py-2 pr-4">{u.twoFactorEnabled ? "On" : "Off"}</td>
                        <td className="py-2 pr-4">{timeAgo(u.lastLoginAt)}</td>
                        <td className="py-2 pr-4">{timeAgo(u.createdAt)}</td>
                        <td className="py-2 pr-4">
                          <Button
                            size="sm"
                            disabled={!dirty || limitMutation.isPending}
                            onClick={() => {
                              const n = Number(draft);
                              if (!Number.isInteger(n) || n < 0) {
                                toast({ title: "Enter a non-negative integer", variant: "destructive" });
                                return;
                              }
                              limitMutation.mutate({ id: u.id, projectLimit: n });
                            }}
                          >Save</Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
