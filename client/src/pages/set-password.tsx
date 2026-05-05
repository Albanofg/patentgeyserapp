import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/theme-toggle";
import { Check, X, Eye, EyeOff, Loader2 } from "lucide-react";
import logoUrl from "@/assets/geyser-logo.png";

const passwordRequirements = [
  { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { label: "One uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "One lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { label: "One number", test: (p: string) => /\d/.test(p) },
  { label: "One special character (!@#$%^&*)", test: (p: string) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(p) },
];

export default function SetPassword() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Read token from ?token= in the URL.
  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("token") || "";
  }, []);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);

  const allPassed = passwordRequirements.every((r) => r.test(password));
  const matches = password.length > 0 && password === confirm;

  const setMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/auth/set-initial-password", { token, password });
    },
    onSuccess: () => {
      toast({ title: "Password set", description: "Welcome to Patent Geyser." });
      setLocation("/");
    },
    onError: (err: Error) => {
      toast({ title: "Could not set password", description: err.message });
    },
  });

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Missing link</CardTitle>
            <CardDescription>
              This page needs a valid token. Please use the link from your welcome email.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex items-center justify-between p-4">
        <img src={logoUrl} alt="Patent Geyser" className="h-8" />
        <ThemeToggle />
      </div>

      <main className="flex-1 flex items-center justify-center px-4 pb-12">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Set your password</CardTitle>
            <CardDescription>
              Choose a password to finish setting up your account.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  data-testid="input-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                  aria-label="Toggle password visibility"
                >
                  {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input
                id="confirm"
                type={showPwd ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                data-testid="input-confirm"
              />
            </div>

            <ul className="space-y-1 text-sm">
              {passwordRequirements.map((r) => {
                const ok = r.test(password);
                return (
                  <li key={r.label} className={`flex items-center gap-2 ${ok ? "text-green-600" : "text-muted-foreground"}`}>
                    {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                    <span>{r.label}</span>
                  </li>
                );
              })}
              <li className={`flex items-center gap-2 ${matches ? "text-green-600" : "text-muted-foreground"}`}>
                {matches ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                <span>Passwords match</span>
              </li>
            </ul>

            <Button
              className="w-full"
              disabled={!allPassed || !matches || setMutation.isPending}
              onClick={() => setMutation.mutate()}
              data-testid="button-submit"
            >
              {setMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Setting password...
                </>
              ) : (
                "Set password"
              )}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
