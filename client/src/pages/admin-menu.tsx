import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, ShieldCheck, Coins, Activity, ChevronRight } from "lucide-react";

interface AdminPage {
  path: string;
  title: string;
  description: string;
  Icon: typeof Users;
}

const PAGES: AdminPage[] = [
  {
    path: "/admin/usage",
    title: "AI Usage",
    description: "Token spend per user, agent, and model. CSV export available.",
    Icon: Activity,
  },
  {
    path: "/admin/users",
    title: "Users",
    description: "Inventor accounts, project counts, login activity, and 2FA status.",
    Icon: Users,
  },
  {
    path: "/admin/whitelist",
    title: "Email Whitelist",
    description: "Manage which emails are allowed to sign up or remain active.",
    Icon: ShieldCheck,
  },
  {
    path: "/admin/credits",
    title: "Credits",
    description: "Grant project credits to inventor accounts.",
    Icon: Coins,
  },
];

export default function AdminMenu() {
  const [, setLocation] = useLocation();
  return (
    <div className="container mx-auto p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Quick links to every admin page. All pages share the same access control —
          if you can see this page, you can open any of them.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {PAGES.map(({ path, title, description, Icon }) => (
          <Card
            key={path}
            className="cursor-pointer hover-elevate transition-all"
            onClick={() => setLocation(path)}
            data-testid={`admin-link-${path.replace(/[^a-z0-9]/gi, "-")}`}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-md bg-primary/10 p-2">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-base">{title}</CardTitle>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-sm">{description}</CardDescription>
              <div className="text-xs text-muted-foreground mt-2 font-mono">{path}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
