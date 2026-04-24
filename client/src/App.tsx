import { useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { CopySelectionButton } from "@/components/copy-selection-button";
import Login from "@/pages/login";
import Register from "@/pages/register";
import ForgotPassword from "@/pages/forgot-password";

function Router() {
  const [location] = useLocation();

  // Render login page outside sidebar layout
  if (location === "/auth/login" || location.startsWith("/auth/login?")) {
    return <Login />;
  }

  // Render forgot password page outside sidebar layout
  if (location === "/auth/forgot-password" || location.startsWith("/auth/forgot-password?")) {
    return <ForgotPassword />;
  }

  // Registration — public (freemium) and legacy hidden URL kept for admin use.
  if (
    location === "/auth/register" || location.startsWith("/auth/register?") ||
    location === "/auth/geyser-new-user"
  ) {
    return <Register />;
  }

  // All other routes get authenticated sidebar layout
  return <AuthenticatedShell />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light" storageKey="patent-geyser-theme">
        <TooltipProvider>
          <Toaster />
          <CopySelectionButton />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
