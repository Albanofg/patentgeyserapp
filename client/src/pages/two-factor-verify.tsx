import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Shield, Mail, Smartphone } from "lucide-react";
import geyserLogo from "@/assets/geyser-logo.png";

interface TwoFactorVerifyProps {
  method: 'email' | 'totp';
  userId: number;
  email: string;
  onSuccess: () => void;
}

export function TwoFactorVerify({ method, userId, email, onSuccess }: TwoFactorVerifyProps) {
  const [code, setCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const { toast } = useToast();

  const sendEmailCode = async () => {
    setIsSendingCode(true);
    try {
      await apiRequest("POST", "/api/2fa/send-code", { userId });
      setCodeSent(true);
      toast({
        title: "Code sent",
        description: "Check your email for the verification code.",
      });
    } catch (error: any) {
      toast({
        title: "Failed to send code",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSendingCode(false);
    }
  };

  const handleVerify = async () => {
    if (!code || code.length !== 6) {
      toast({
        title: "Invalid code",
        description: "Please enter a 6-digit code.",
        variant: "destructive",
      });
      return;
    }

    setIsVerifying(true);
    try {
      await apiRequest("POST", "/api/2fa/verify", { userId, code });
      
      await queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      
      toast({
        title: "Welcome back!",
        description: "You've successfully logged in.",
      });
      
      onSuccess();
    } catch (error: any) {
      toast({
        title: "Verification failed",
        description: error.message || "Invalid or expired code.",
        variant: "destructive",
      });
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-4">
          <div className="flex items-center justify-center gap-3">
            <img src={geyserLogo} alt="Patent Geyser" className="h-12 w-auto" />
            <div className="flex flex-col leading-tight text-left">
              <span className="text-2xl font-bold">Patent Geyser</span>
              <span className="text-xs text-muted-foreground">Provisional Patent Draft Generator</span>
            </div>
          </div>
          <div className="flex justify-center">
            <div className="p-3 rounded-full bg-primary/10">
              <Shield className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle>Two-Factor Authentication</CardTitle>
          <CardDescription>
            {method === 'email' 
              ? "Enter the verification code sent to your email"
              : "Enter the code from your authenticator app"
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            {method === 'email' ? (
              <>
                <Mail className="h-4 w-4" />
                <span>{email}</span>
              </>
            ) : (
              <>
                <Smartphone className="h-4 w-4" />
                <span>Authenticator App</span>
              </>
            )}
          </div>

          {method === 'email' && !codeSent && (
            <Button
              onClick={sendEmailCode}
              disabled={isSendingCode}
              className="w-full"
              data-testid="button-send-2fa-code"
            >
              {isSendingCode ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                "Send Verification Code"
              )}
            </Button>
          )}

          {(method === 'totp' || codeSent) && (
            <>
              <div className="space-y-2">
                <Label htmlFor="verify-code">Verification Code</Label>
                <Input
                  id="verify-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="text-center text-2xl tracking-widest"
                  data-testid="input-2fa-code"
                />
              </div>

              <Button
                onClick={handleVerify}
                disabled={isVerifying || code.length !== 6}
                className="w-full"
                data-testid="button-verify-2fa"
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify"
                )}
              </Button>

              {method === 'email' && (
                <Button
                  variant="ghost"
                  onClick={sendEmailCode}
                  disabled={isSendingCode}
                  className="w-full"
                  data-testid="button-resend-code"
                >
                  {isSendingCode ? "Sending..." : "Resend Code"}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default TwoFactorVerify;
