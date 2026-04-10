import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { Loader2, User, Shield, Mail, Smartphone, CheckCircle2, XCircle, ArrowLeft, Lock, Key, AlertTriangle } from "lucide-react";
import { useLocation } from "wouter";
import type { User as UserType } from "@shared/schema";

export default function UserSettings() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [selectedMethod, setSelectedMethod] = useState<'email' | 'totp'>('email');
  const [verificationCode, setVerificationCode] = useState('');
  const [showSetup, setShowSetup] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  
  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [showResetForm, setShowResetForm] = useState(false);

  const { data: user, isLoading } = useQuery<UserType & { 
    twoFactorEnabled: boolean;
    twoFactorMethod: string | null;
  }>({
    queryKey: ["/api/auth/user"],
  });

  const initiate2FAMutation = useMutation({
    mutationFn: async (method: 'email' | 'totp') => {
      return await apiRequest("POST", "/api/2fa/initiate", { method });
    },
    onSuccess: (data) => {
      if (selectedMethod === 'totp' && data.qrCodeUrl) {
        setQrCodeUrl(data.qrCodeUrl);
        setTotpSecret(data.secret);
      }
      if (selectedMethod === 'email') {
        toast({
          title: "Verification code sent",
          description: "Check your email for the 6-digit code",
        });
      }
    },
    onError: () => {
      toast({
        title: "Could not start setup",
        description: "Please try again in a moment",
      });
    },
  });

  const verify2FAMutation = useMutation({
    mutationFn: async (code: string) => {
      return await apiRequest("POST", "/api/2fa/verify-setup", { code });
    },
    onSuccess: () => {
      toast({
        title: "2FA Enabled",
        description: "Two-factor authentication is now active on your account",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setShowSetup(false);
      setQrCodeUrl(null);
      setTotpSecret(null);
      setVerificationCode('');
    },
    onError: () => {
      toast({
        title: "Invalid code",
        description: "The verification code was incorrect. Please try again.",
      });
    },
  });

  const disable2FAMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/2fa/disable", {});
    },
    onSuccess: () => {
      toast({
        title: "2FA Disabled",
        description: "Two-factor authentication has been disabled",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
    onError: () => {
      toast({
        title: "Could not disable 2FA",
        description: "Please try again in a moment",
      });
    },
  });

  // Password change mutation (requires current password)
  const changePasswordMutation = useMutation({
    mutationFn: async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) => {
      return await apiRequest("POST", "/api/auth/change-password", { currentPassword, newPassword });
    },
    onSuccess: () => {
      toast({
        title: "Password Changed",
        description: "Your password has been updated successfully",
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: (error: any) => {
      toast({
        title: "Password Change Failed",
        description: error?.message || "Please check your current password and try again",
      });
    },
  });

  // Request password reset code mutation
  const requestResetMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/auth/request-password-reset", {});
    },
    onSuccess: () => {
      toast({
        title: "Reset Code Sent",
        description: "Check your email for the 6-digit reset code",
      });
      setShowResetForm(true);
    },
    onError: () => {
      toast({
        title: "Could not send reset code",
        description: "Please try again in a moment",
      });
    },
  });

  // Reset password with code mutation
  const resetPasswordMutation = useMutation({
    mutationFn: async ({ code, newPassword }: { code: string; newPassword: string }) => {
      return await apiRequest("POST", "/api/auth/reset-password", { code, newPassword });
    },
    onSuccess: () => {
      toast({
        title: "Password Reset",
        description: "Your password has been reset successfully",
      });
      setResetCode('');
      setNewPassword('');
      setConfirmPassword('');
      setShowResetForm(false);
    },
    onError: (error: any) => {
      toast({
        title: "Password Reset Failed",
        description: error?.message || "Invalid or expired reset code",
      });
    },
  });

  const handleChangePassword = () => {
    if (newPassword !== confirmPassword) {
      toast({
        title: "Passwords don't match",
        description: "Please make sure your new passwords match",
      });
      return;
    }
    if (newPassword.length < 6) {
      toast({
        title: "Password too short",
        description: "Password must be at least 6 characters",
      });
      return;
    }
    changePasswordMutation.mutate({ currentPassword, newPassword });
  };

  const handleResetPassword = () => {
    if (newPassword !== confirmPassword) {
      toast({
        title: "Passwords don't match",
        description: "Please make sure your new passwords match",
      });
      return;
    }
    if (newPassword.length < 6) {
      toast({
        title: "Password too short",
        description: "Password must be at least 6 characters",
      });
      return;
    }
    resetPasswordMutation.mutate({ code: resetCode, newPassword });
  };

  const handleStartSetup = () => {
    setShowSetup(true);
    initiate2FAMutation.mutate(selectedMethod);
  };

  const handleVerify = () => {
    if (verificationCode.length === 6) {
      verify2FAMutation.mutate(verificationCode);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation("/dashboard")}
          data-testid="button-back-dashboard"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Manage your account settings and security</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-5 w-5" />
            <CardTitle>Profile</CardTitle>
          </div>
          <CardDescription>Your account information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Email</Label>
            <div className="flex items-center gap-2">
              <Input value={user?.email || ''} disabled className="bg-muted" data-testid="input-email" />
              <Badge variant="secondary">Verified</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Your email is managed through Replit authentication
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            <CardTitle>Two-Factor Authentication</CardTitle>
          </div>
          <CardDescription>
            Add an extra layer of security to your account
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {user?.twoFactorEnabled ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 border rounded-lg bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="font-medium">2FA is enabled</p>
                    <p className="text-sm text-muted-foreground">
                      Using {user.twoFactorMethod === 'totp' ? 'Authenticator App' : 'Email'} verification
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className="text-green-600 border-green-600">
                  Active
                </Badge>
              </div>
              <Button
                variant="outline"
                onClick={() => disable2FAMutation.mutate()}
                disabled={disable2FAMutation.isPending}
                data-testid="button-disable-2fa"
              >
                {disable2FAMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Disable 2FA
              </Button>
            </div>
          ) : showSetup ? (
            <div className="space-y-6">
              {selectedMethod === 'email' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-4 border rounded-lg bg-muted/50">
                    <Mail className="h-8 w-8 text-primary" />
                    <div>
                      <p className="font-medium">Email Verification</p>
                      <p className="text-sm text-muted-foreground">
                        We sent a 6-digit code to {user?.email}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="code">Enter verification code</Label>
                    <Input
                      id="code"
                      placeholder="000000"
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      maxLength={6}
                      className="text-center text-2xl tracking-widest"
                      data-testid="input-2fa-code"
                    />
                  </div>
                </div>
              )}

              {selectedMethod === 'totp' && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-4 border rounded-lg bg-muted/50">
                    <Smartphone className="h-8 w-8 text-primary" />
                    <div>
                      <p className="font-medium">Authenticator App</p>
                      <p className="text-sm text-muted-foreground">
                        Scan the QR code with Google Authenticator or Authy
                      </p>
                    </div>
                  </div>
                  
                  {qrCodeUrl ? (
                    <div className="flex flex-col items-center space-y-4">
                      <div className="p-4 bg-white rounded-lg">
                        <img src={qrCodeUrl} alt="QR Code for authenticator app" className="w-48 h-48" data-testid="img-qr-code" />
                      </div>
                      {totpSecret && (
                        <div className="text-center">
                          <p className="text-xs text-muted-foreground mb-1">Or enter this code manually:</p>
                          <code className="text-sm bg-muted px-2 py-1 rounded font-mono" data-testid="text-totp-secret">
                            {totpSecret}
                          </code>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex justify-center p-8">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="totp-code">Enter code from app</Label>
                    <Input
                      id="totp-code"
                      placeholder="000000"
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      maxLength={6}
                      className="text-center text-2xl tracking-widest"
                      data-testid="input-totp-code"
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowSetup(false);
                    setQrCodeUrl(null);
                    setTotpSecret(null);
                    setVerificationCode('');
                  }}
                  data-testid="button-cancel-setup"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleVerify}
                  disabled={verificationCode.length !== 6 || verify2FAMutation.isPending}
                  data-testid="button-verify-2fa"
                >
                  {verify2FAMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Verify & Enable
                </Button>
                {selectedMethod === 'email' && (
                  <Button
                    variant="ghost"
                    onClick={() => initiate2FAMutation.mutate('email')}
                    disabled={initiate2FAMutation.isPending}
                    data-testid="button-resend-code"
                  >
                    Resend Code
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center gap-3 p-4 border rounded-lg border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20">
                <XCircle className="h-5 w-5 text-amber-600" />
                <div>
                  <p className="font-medium">2FA is not enabled</p>
                  <p className="text-sm text-muted-foreground">
                    Your account is less secure without two-factor authentication
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <Label>Choose your preferred method</Label>
                <RadioGroup
                  value={selectedMethod}
                  onValueChange={(value) => setSelectedMethod(value as 'email' | 'totp')}
                  className="space-y-3"
                >
                  <div className="flex items-start space-x-3 p-4 border rounded-lg hover-elevate cursor-pointer" onClick={() => setSelectedMethod('email')}>
                    <RadioGroupItem value="email" id="email" className="mt-1" data-testid="radio-email" />
                    <div className="flex-1">
                      <Label htmlFor="email" className="flex items-center gap-2 cursor-pointer">
                        <Mail className="h-4 w-4" />
                        Email Verification
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Receive a 6-digit code via email each time you log in
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start space-x-3 p-4 border rounded-lg hover-elevate cursor-pointer" onClick={() => setSelectedMethod('totp')}>
                    <RadioGroupItem value="totp" id="totp" className="mt-1" data-testid="radio-totp" />
                    <div className="flex-1">
                      <Label htmlFor="totp" className="flex items-center gap-2 cursor-pointer">
                        <Smartphone className="h-4 w-4" />
                        Authenticator App
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Use Google Authenticator, Authy, or similar apps
                      </p>
                    </div>
                  </div>
                </RadioGroup>
              </div>

              <Button onClick={handleStartSetup} disabled={initiate2FAMutation.isPending} data-testid="button-enable-2fa">
                {initiate2FAMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Set Up 2FA
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Password Management Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            <CardTitle>Password</CardTitle>
          </div>
          <CardDescription>
            Change your account password
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!showResetForm ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current-password">Current Password</Label>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter your current password"
                  data-testid="input-current-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">New Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password (min. 6 characters)"
                  data-testid="input-new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm New Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your new password"
                  data-testid="input-confirm-password"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={handleChangePassword}
                  disabled={!currentPassword || !newPassword || !confirmPassword || changePasswordMutation.isPending}
                  data-testid="button-change-password"
                >
                  {changePasswordMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Change Password
                </Button>
                <span className="text-sm text-muted-foreground">or</span>
                <Button
                  variant="outline"
                  onClick={() => requestResetMutation.mutate()}
                  disabled={requestResetMutation.isPending}
                  data-testid="button-forgot-password"
                >
                  {requestResetMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  <Key className="h-4 w-4 mr-2" />
                  Forgot Password? Reset via Email
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 border rounded-lg border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20">
                <Mail className="h-5 w-5 text-blue-600" />
                <div>
                  <p className="font-medium">Reset code sent</p>
                  <p className="text-sm text-muted-foreground">
                    Check your email for the 6-digit reset code
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reset-code">Reset Code</Label>
                <Input
                  id="reset-code"
                  type="text"
                  maxLength={6}
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="Enter 6-digit code"
                  data-testid="input-reset-code"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reset-new-password">New Password</Label>
                <Input
                  id="reset-new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password (min. 6 characters)"
                  data-testid="input-reset-new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reset-confirm-password">Confirm New Password</Label>
                <Input
                  id="reset-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your new password"
                  data-testid="input-reset-confirm-password"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowResetForm(false);
                    setResetCode('');
                    setNewPassword('');
                    setConfirmPassword('');
                  }}
                  data-testid="button-cancel-reset"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleResetPassword}
                  disabled={resetCode.length !== 6 || !newPassword || !confirmPassword || resetPasswordMutation.isPending}
                  data-testid="button-reset-password"
                >
                  {resetPasswordMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Reset Password
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => requestResetMutation.mutate()}
                  disabled={requestResetMutation.isPending}
                  data-testid="button-resend-reset-code"
                >
                  Resend Code
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cancel Subscription */}
      <Card className="border-destructive/30">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <CardTitle className="text-base text-destructive">Cancel Subscription</CardTitle>
          </div>
          <CardDescription>
            Canceling will remove your access to AI features at the end of your billing period.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <a href={`https://patentgeyser.com/cancel?email=${encodeURIComponent(user?.email || "")}`} data-testid="link-cancel-subscription">
            <Button variant="destructive">
              Cancel Subscription
            </Button>
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
