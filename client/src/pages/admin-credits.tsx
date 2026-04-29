import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Minus, Plus } from "lucide-react";

interface InventorAdminUser {
  id: string;
  email: string;
  projectLimit: number;
  projectCount: number;
}

export default function AdminCredits() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [delta, setDelta] = useState("1");

  const { data: users = [], isLoading } = useQuery<InventorAdminUser[]>({
    queryKey: ["/api/admin/inventors-users"],
    retry: false,
  });

  const setLimitMutation = useMutation({
    mutationFn: async ({ id, projectLimit }: { id: string; projectLimit: number }) =>
      apiRequest("PATCH", `/api/admin/inventors-users/${id}/project-limit`, { projectLimit }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/inventors-users"] });
    },
  });

  function applyDelta(user: InventorAdminUser, change: number) {
    const next = Math.max(0, user.projectLimit + change);
    setLimitMutation.mutate(
      { id: user.id, projectLimit: next },
      {
        onSuccess: () => toast({ title: `${user.email}: ${user.projectLimit} → ${next}` }),
        onError: () => toast({ title: "Update failed", variant: "destructive" }),
      }
    );
  }

  function applyByEmail() {
    const match = users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!match) {
      toast({ title: "No user with that email", variant: "destructive" });
      return;
    }
    const n = Number(delta);
    if (!Number.isInteger(n)) {
      toast({ title: "Delta must be an integer", variant: "destructive" });
      return;
    }
    applyDelta(match, n);
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Grant Credits</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Add or remove project credits for a user. Changes apply instantly.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick grant</CardTitle>
          <CardDescription>Type an email and a delta. Negative numbers revoke.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-3 items-end">
          <div className="flex-1 w-full">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="w-24">
            <Label htmlFor="delta">Delta</Label>
            <Input
              id="delta"
              type="number"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
            />
          </div>
          <Button onClick={applyByEmail} disabled={setLimitMutation.isPending}>
            Apply
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All users</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users yet.</p>
          ) : (
            <div className="space-y-2">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between gap-3 py-2 border-b last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{u.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {u.projectLimit} credit{u.projectLimit === 1 ? "" : "s"} · {u.projectCount} used
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="outline"
                      aria-label="Remove one credit"
                      disabled={setLimitMutation.isPending || u.projectLimit <= 0}
                      onClick={() => applyDelta(u, -1)}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      aria-label="Add one credit"
                      disabled={setLimitMutation.isPending}
                      onClick={() => applyDelta(u, 1)}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={setLimitMutation.isPending}
                      onClick={() => applyDelta(u, 5)}
                    >
                      +5
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
