import { useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { Loader2 } from "lucide-react";

export default function Agent1() {
  const [, params] = useRoute("/project/:id/agent/1");
  const [, setLocation] = useLocation();
  const projectId = params?.id;

  useEffect(() => {
    if (projectId) {
      setLocation(`/project/${projectId}/agent/1a`);
    }
  }, [projectId, setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
