import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/theme-toggle";
import { Check, X, Eye, EyeOff } from "lucide-react";
import logoUrl from "@/assets/geyser-logo.png";

interface PasswordRequirement {
  label: string;
  test: (password: string) => boolean;
}

const passwordRequirements: PasswordRequirement[] = [
  { label: "At least 8 characters", test: (p) => p.length >= 8 },
  { label: "One uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { label: "One lowercase letter", test: (p) => /[a-z]/.test(p) },
  { label: "One number", test: (p) => /\d/.test(p) },
  { label: "One special character (!@#$%^&*)", test: (p) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(p) },
];

export default function Register() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const passwordChecks = useMemo(() => {
    return passwordRequirements.map((req) => ({
      ...req,
      passed: req.test(password),
    }));
  }, [password]);

  const isPasswordValid = useMemo(() => {
    return passwordChecks.every((check) => check.passed);
  }, [passwordChecks]);

  const registerMutation = useMutation({
    mutationFn: async () => {
      if (!isPasswordValid) {
        throw new Error("Please meet all password requirements");
      }
      const response = await apiRequest("POST", "/api/auth/register", { email, password });
      return response;
    },
    onSuccess: async () => {
      toast({
        title: "Account created!",
        description: "You've successfully registered. Logging you in...",
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      await queryClient.refetchQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/");
    },
    onError: (error: Error) => {
      toast({
        title: "Registration failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    registerMutation.mutate();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2 text-center">
          <div className="flex items-center justify-center gap-3 mb-2">
            <img src={logoUrl} alt="Patent Geyser Logo" className="h-12 w-12" />
            <div className="flex flex-col leading-tight text-left">
              <span className="text-2xl font-bold">Patent Geyser</span>
              <span className="text-xs text-muted-foreground">Provisional Patent Draft Generator</span>
            </div>
          </div>
          <CardTitle>Create Account</CardTitle>
          <CardDescription>
            Create your account to start building patent applications
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                data-testid="input-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  data-testid="input-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  data-testid="button-toggle-password"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <div className="mt-3 space-y-2 p-3 rounded-md bg-muted/50" data-testid="password-requirements">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Password must contain:
                </p>
                {passwordChecks.map((check, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 text-xs transition-all duration-200 ease-in-out"
                    data-testid={`requirement-${index}`}
                  >
                    {check.passed ? (
                      <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
                    ) : (
                      <X className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className={`transition-all duration-200 ease-in-out ${
                      check.passed
                        ? "text-green-600 dark:text-green-400 line-through"
                        : "text-muted-foreground"
                    }`}>
                      {check.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <Button
              type="submit"
              data-testid="button-submit"
              className="w-full"
              disabled={registerMutation.isPending || !isPasswordValid}
            >
              {registerMutation.isPending ? "Creating account..." : "Create Account"}
            </Button>
          </form>
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => setLocation("/auth/login")}
              className="text-sm text-muted-foreground hover:text-primary hover:underline transition-all duration-200 ease-in-out"
            >
              Already have an account? Sign in
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
