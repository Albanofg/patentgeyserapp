import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Lightbulb, RefreshCw, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CurrentIdeaData {
  currentIdea: string | null;
  currentVersion: number;
  snapshots: any[];
}

interface CurrentIdeaModalProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CurrentIdeaModal({ projectId, open, onOpenChange }: CurrentIdeaModalProps) {
  const { toast } = useToast();
  
  const { data, isLoading } = useQuery<CurrentIdeaData>({
    queryKey: ["/api/projects", projectId, "current-idea"],
    enabled: !!projectId && open,
  });

  const backfillMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/projects/${projectId}/backfill-snapshots`);
    },
    onSuccess: (result: any) => {
      toast({
        title: "Idea Loaded",
        description: "Your idea has been loaded successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "current-idea"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Load",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const hasIdea = data?.currentIdea || (data?.snapshots && data.snapshots.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-primary" />
            Your Current Idea
          </DialogTitle>
        </DialogHeader>
        
        <div className="max-h-[60vh] overflow-y-auto pr-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-pulse text-muted-foreground">Loading...</div>
            </div>
          ) : !hasIdea ? (
            <div className="text-center py-8">
              <Lightbulb className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">No idea recorded yet.</p>
              <p className="text-sm text-muted-foreground mb-4">
                If this is an older project, click below to load your idea.
              </p>
              <Button
                onClick={() => backfillMutation.mutate()}
                disabled={backfillMutation.isPending}
                variant="outline"
                data-testid="button-reconstruct-timeline"
              >
                {backfillMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Load Idea
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown>{data?.currentIdea || ''}</ReactMarkdown>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CurrentIdeaButton({ projectId }: { projectId: string }) {
  const { data } = useQuery<CurrentIdeaData>({
    queryKey: ["/api/projects", projectId, "current-idea"],
    enabled: !!projectId,
  });

  const hasIdea = data?.currentIdea || (data?.snapshots && data.snapshots.length > 0);
  const snapshotCount = data?.snapshots?.length || 0;

  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start gap-2"
      data-testid="button-view-current-idea"
    >
      <Lightbulb className={`h-4 w-4 ${hasIdea ? 'text-primary' : 'text-muted-foreground'}`} />
      <span>Current Idea</span>
    </Button>
  );
}
