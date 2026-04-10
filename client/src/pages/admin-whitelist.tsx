import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Trash2, Plus, ShieldCheck, Mail, PauseCircle, PlayCircle } from "lucide-react";

interface WhitelistEntry {
  id: string;
  email: string;
  note: string | null;
  status: string;
  addedAt: string;
}

export default function AdminWhitelist() {
  const { toast } = useToast();
  const [newEmail, setNewEmail] = useState("");
  const [newNote, setNewNote] = useState("");

  const { data: entries = [], isLoading } = useQuery<WhitelistEntry[]>({
    queryKey: ["/api/admin/whitelist"],
  });

  const addMutation = useMutation({
    mutationFn: async ({ email, note }: { email: string; note: string }) => {
      return await apiRequest("POST", "/api/admin/whitelist", { email, note: note || undefined });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/whitelist"] });
      setNewEmail("");
      setNewNote("");
      toast({ title: "Email added", description: "The email has been added to the whitelist." });
    },
    onError: (error: any) => {
      toast({
        title: "Could not add email",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (email: string) => {
      return await apiRequest("DELETE", `/api/admin/whitelist/${encodeURIComponent(email)}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/whitelist"] });
      toast({ title: "Email removed", description: "Access has been revoked for that address." });
    },
    onError: () => {
      toast({ title: "Could not remove email", variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ email, status }: { email: string; status: string }) => {
      return await apiRequest("PATCH", `/api/admin/whitelist/${encodeURIComponent(email)}/status`, { status });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/whitelist"] });
      toast({
        title: variables.status === "read_only" ? "User suspended" : "User reactivated",
        description: variables.status === "read_only"
          ? "AI features are now blocked for this user."
          : "Full access restored.",
      });
    },
    onError: () => {
      toast({ title: "Could not update status", variant: "destructive" });
    },
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim()) return;
    addMutation.mutate({ email: newEmail.trim(), note: newNote.trim() });
  };

  const activeCount = entries.filter(e => e.status !== "read_only").length;
  const readOnlyCount = entries.filter(e => e.status === "read_only").length;

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-md bg-primary/10">
          <ShieldCheck className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Access Whitelist</h1>
          <p className="text-sm text-muted-foreground">Only emails on this list can register or log in.</p>
        </div>
      </div>

      {/* Add email form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Add Email</CardTitle>
          <CardDescription>Grant access to a new email address.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="new-email">Email address</Label>
              <Input
                id="new-email"
                type="email"
                placeholder="user@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                data-testid="input-whitelist-email"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-note">
                Note <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="new-note"
                placeholder="e.g. John Smith — client"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                data-testid="input-whitelist-note"
              />
            </div>
            <Button
              type="submit"
              disabled={addMutation.isPending || !newEmail.trim()}
              data-testid="button-add-whitelist"
            >
              {addMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Add to Whitelist
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Current whitelist */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <CardTitle className="text-base">Allowed Emails</CardTitle>
              <CardDescription>Suspend lapsed subscribers — they keep read access but AI features pause.</CardDescription>
            </div>
            {!isLoading && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary" data-testid="text-whitelist-count">
                  {activeCount} active
                </Badge>
                {readOnlyCount > 0 && (
                  <Badge variant="outline" className="text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700">
                    {readOnlyCount} suspended
                  </Badge>
                )}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center gap-2">
              <Mail className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No emails whitelisted yet.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {entries.map((entry) => {
                const isReadOnly = entry.status === "read_only";
                return (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    data-testid={`row-whitelist-${entry.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className={`text-sm font-medium truncate ${isReadOnly ? "text-muted-foreground" : ""}`} data-testid={`text-whitelist-email-${entry.id}`}>
                          {entry.email}
                        </p>
                        {isReadOnly && (
                          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700 shrink-0">
                            suspended
                          </Badge>
                        )}
                      </div>
                      {entry.note && (
                        <p className="text-xs text-muted-foreground truncate">{entry.note}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => statusMutation.mutate({ email: entry.email, status: isReadOnly ? "active" : "read_only" })}
                        disabled={statusMutation.isPending}
                        title={isReadOnly ? "Reactivate" : "Suspend"}
                        data-testid={`button-toggle-status-${entry.id}`}
                      >
                        {isReadOnly ? (
                          <PlayCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                        ) : (
                          <PauseCircle className="h-4 w-4 text-amber-500" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => removeMutation.mutate(entry.email)}
                        disabled={removeMutation.isPending}
                        data-testid={`button-remove-whitelist-${entry.id}`}
                      >
                        {removeMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
