import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/theme-toggle";
import { ArrowLeft, Check, X, Eye, EyeOff, Mail, Smartphone, Loader2 } from "lucide-react";
import logoUrl from "@assets/geyser logo_1763486061835.png";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

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

type Step = 'email' | 'verify' | 'reset' | 'success';
type VerifyMethod = 'email' | 'totp';

export default function ForgotPassword() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState("");
  const [verifyMethod, setVerifyMethod] = useState<VerifyMethod>('email');
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resetToken, setResetToken] = useState("");

  const passwordChecks = passwordRequirements.map((req) => ({
    ...req,
    passed: req.test(newPassword),
  }));

  const isPasswordValid = passwordChecks.every((check) => check.passed);

  const initResetMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/forgot-password/init", { email });
      return response;
    },
    onSuccess: (data: any) => {
      setVerifyMethod(data.method);
      if (data.method === 'totp') {
        toast({
          title: "Enter your authenticator code",
          description: "Use your authenticator app to get a 6-digit code.",
        });
      } else {
        toast({
          title: "Verification code sent",
          description: "Check your email for a 6-digit code.",
        });
      }
      setStep('verify');
    },
    onError: (error: Error) => {
      toast({
        title: "Unable to process request",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const verifyCodeMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/forgot-password/verify", { 
        email, 
        code,
        method: verifyMethod 
      });
      return response;
    },
    onSuccess: (data: any) => {
      setResetToken(data.resetToken);
      toast({
        title: "Verified!",
        description: "You can now set a new password.",
      });
      setStep('reset');
    },
    onError: (error: Error) => {
      toast({
        title: "Verification failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/forgot-password/reset", { 
        email,
        resetToken,
        newPassword
      });
      return response;
    },
    onSuccess: () => {
      toast({
        title: "Password reset successful!",
        description: "You can now sign in with your new password.",
      });
      setStep('success');
    },
    onError: (error: Error) => {
      toast({
        title: "Reset failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    initResetMutation.mutate();
  };

  const handleVerifySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;
    verifyCodeMutation.mutate();
  };

  const handleResetSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPasswordValid) return;
    resetPasswordMutation.mutate();
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
          
          {step === 'email' && (
            <>
              <CardTitle>Reset Password</CardTitle>
              <CardDescription>
                Enter your email address and we'll help you reset your password
              </CardDescription>
            </>
          )}
          
          {step === 'verify' && (
            <>
              <CardTitle>Verify Your Identity</CardTitle>
              <CardDescription className="flex items-center justify-center gap-2">
                {verifyMethod === 'totp' ? (
                  <>
                    <Smartphone className="h-4 w-4" />
                    Enter the code from your authenticator app
                  </>
                ) : (
                  <>
                    <Mail className="h-4 w-4" />
                    Enter the code sent to your email
                  </>
                )}
              </CardDescription>
            </>
          )}
          
          {step === 'reset' && (
            <>
              <CardTitle>Set New Password</CardTitle>
              <CardDescription>
                Create a strong password for your account
              </CardDescription>
            </>
          )}
          
          {step === 'success' && (
            <>
              <CardTitle className="text-green-600 dark:text-green-400">Password Reset Complete</CardTitle>
              <CardDescription>
                Your password has been successfully changed
              </CardDescription>
            </>
          )}
        </CardHeader>
        
        <CardContent>
          {step === 'email' && (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  data-testid="input-forgot-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <Button
                type="submit"
                data-testid="button-send-code"
                className="w-full"
                disabled={initResetMutation.isPending || !email}
              >
                {initResetMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Continue"
                )}
              </Button>
            </form>
          )}
          
          {step === 'verify' && (
            <form onSubmit={handleVerifySubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Verification Code</Label>
                <div className="flex justify-center">
                  <InputOTP
                    maxLength={6}
                    value={code}
                    onChange={setCode}
                    data-testid="input-verify-code"
                  >
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                      <InputOTPSlot index={2} />
                      <InputOTPSlot index={3} />
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                <p className="text-xs text-muted-foreground text-center mt-2">
                  {verifyMethod === 'totp' 
                    ? "Open your authenticator app to get the code"
                    : "The code will expire in 10 minutes"}
                </p>
              </div>
              <Button
                type="submit"
                data-testid="button-verify-code"
                className="w-full"
                disabled={verifyCodeMutation.isPending || code.length !== 6}
              >
                {verifyCodeMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify"
                )}
              </Button>
              
              {verifyMethod === 'email' && (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => initResetMutation.mutate()}
                  disabled={initResetMutation.isPending}
                >
                  Resend code
                </Button>
              )}
            </form>
          )}
          
          {step === 'reset' && (
            <form onSubmit={handleResetSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <div className="relative">
                  <Input
                    id="newPassword"
                    data-testid="input-new-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                
                <div className="mt-3 space-y-2 p-3 rounded-md bg-muted/50">
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Password must contain:
                  </p>
                  {passwordChecks.map((check, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 text-xs"
                    >
                      {check.passed ? (
                        <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
                      ) : (
                        <X className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                      <span className={
                        check.passed 
                          ? "text-green-600 dark:text-green-400 line-through" 
                          : "text-muted-foreground"
                      }>
                        {check.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              
              <Button
                type="submit"
                data-testid="button-reset-password"
                className="w-full"
                disabled={resetPasswordMutation.isPending || !isPasswordValid}
              >
                {resetPasswordMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Resetting...
                  </>
                ) : (
                  "Reset Password"
                )}
              </Button>
            </form>
          )}
          
          {step === 'success' && (
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="rounded-full bg-green-100 dark:bg-green-900/30 p-3">
                  <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
                </div>
              </div>
              <Button
                className="w-full"
                data-testid="button-back-to-login"
                onClick={() => setLocation("/auth/login")}
              >
                Back to Sign In
              </Button>
            </div>
          )}
          
          {step !== 'success' && (
            <div className="mt-4 text-center">
              <button
                type="button"
                data-testid="button-back-to-login-link"
                onClick={() => setLocation("/auth/login")}
                className="text-sm text-primary hover:underline inline-flex items-center gap-1"
              >
                <ArrowLeft className="h-3 w-3" />
                Back to Sign In
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
