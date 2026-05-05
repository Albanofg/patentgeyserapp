import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { FileText, Plus, Loader2, Trash2, Edit } from "lucide-react";
import type { Project } from "@shared/schema";
import logoUrl from "@/assets/geyser-logo.png";

interface AuthUser {
  id: string;
  email: string;
  kind: "legacy" | "paid";
  credits?: number;
  creditsUsed?: number;
  creditsRemaining?: number;
  embedUrl?: string | null;
  twoFactorEnabled: boolean;
  twoFactorVerified: boolean;
  subscriptionStatus: string;
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [createNameError, setCreateNameError] = useState("");
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editedName, setEditedName] = useState("");
  const [limitInfo, setLimitInfo] = useState<null | {
    credits: number;
    creditsUsed: number;
    embedUrl: string | null;
  }>(null);
  const [buyDialogOpen, setBuyDialogOpen] = useState(false);

  const { data: user, isLoading: userLoading } = useQuery<AuthUser>({
    queryKey: ["/api/auth/user"],
    retry: false,
  });

  const isPaid = user?.kind === "paid";
  const creditsRemaining = user?.creditsRemaining ?? 0;
  const outOfCredits = isPaid && creditsRemaining <= 0;

  const { data: projects, isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
    enabled: !!user,
  });

  const createProjectMutation = useMutation<Project>({
    mutationFn: async () => {
      const projectName = newProjectName.trim();
      if (!projectName) {
        throw new Error("Project name is required");
      }
      return await apiRequest<Project>("POST", "/api/projects", {
        title: projectName,
        currentStage: 1,
        completed: 0,
      });
    },
    onSuccess: (newProject) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: "Project created!",
        description: "Starting your patent application journey.",
      });
      setShowCreateDialog(false);
      setNewProjectName("");
      setCreateNameError("");
      setLocation(`/project/${newProject.id}/agent/1`);
    },
    onError: (error: any) => {
      if (error?.body?.code === "PROJECT_LIMIT_REACHED") {
        setLimitInfo({
          credits: error.body.credits,
          creditsUsed: error.body.creditsUsed,
          embedUrl: error.body.embedUrl || null,
        });
        setShowCreateDialog(false);
        setNewProjectName("");
        setCreateNameError("");
        return;
      }
      toast({
        title: "Failed to create project",
        description: error.message,
      });
    },
  });

  const updateProjectMutation = useMutation({
    mutationFn: async ({ projectId, title }: { projectId: string; title: string }) => {
      return await apiRequest("PATCH", `/api/projects/${projectId}`, { title });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({
        title: "Project updated",
        description: "Project name has been changed.",
      });
      setEditingProject(null);
      setEditedName("");
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update project",
        description: error.message,
        // Softer UX - no red banner
      });
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async (projectId: string) => {
      await apiRequest("DELETE", `/api/projects/${projectId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({
        title: "Project deleted",
        description: "Your project has been permanently removed.",
      });
      setProjectToDelete(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete project",
        description: error.message,
        // Softer UX - no red banner
      });
    },
  });

  const getStageLabel = (stage: number) => {
    const stages = [
      "Intake & Screening",
      "Refinement Workshop",
      "Prior Art Research",
      "White Space Analysis",
      "Diagram Generation",
    ];
    return stages[stage - 1] || "Unknown";
  };

  useEffect(() => {
    if (!userLoading && !user) {
      setLocation("/login");
    }
  }, [userLoading, user, setLocation]);

  if (userLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="bg-background p-4 sm:p-8">
      <main className="max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div className="flex items-center gap-3 sm:gap-4">
            <img src={logoUrl} alt="Patent Geyser Logo" className="h-10 w-10 sm:h-12 sm:w-12 flex-shrink-0" />
            <div className="min-w-0">
              <h2 className="text-2xl sm:text-3xl font-bold leading-tight">Your Patent Projects</h2>
              <p className="text-muted-foreground text-sm sm:text-base mt-1 sm:mt-2">
                Create and manage your provisional patent applications
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            {isPaid && (
              <span
                className="text-sm text-muted-foreground whitespace-nowrap"
                data-testid="text-credits-remaining"
              >
                {creditsRemaining} project credit{creditsRemaining === 1 ? "" : "s"}
              </span>
            )}
            {outOfCredits ? (
              <Button
                data-testid="button-buy-credits"
                size="default"
                className="w-full sm:w-auto"
                onClick={() => setBuyDialogOpen(true)}
              >
                <Plus className="h-5 w-5 mr-2" />
                Buy more credits
              </Button>
            ) : (
              <Button
                data-testid="button-create-project"
                size="default"
                className="w-full sm:w-auto"
                onClick={() => setShowCreateDialog(true)}
              >
                <Plus className="h-5 w-5 mr-2" />
                New Project
              </Button>
            )}
          </div>
        </div>

        {projectsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : projects && projects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <Card
                key={project.id}
                className="hover-elevate transition-all flex flex-col"
                data-testid={`card-project-${project.id}`}
              >
                <div 
                  className="cursor-pointer flex-1"
                  onClick={() => setLocation(`/project/${project.id}/agent/${project.currentStage}`)}
                >
                  <CardHeader>
                    {project.completed === 1 && (
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <Badge variant="secondary">Complete</Badge>
                      </div>
                    )}
                    <CardTitle className="text-xl mb-2">{project.title}</CardTitle>
                    <CardDescription>
                      Created {new Date(project.createdAt!).toLocaleDateString()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-1">Current Stage</p>
                      <p className="text-sm font-semibold">
                        Stage {project.currentStage}: {getStageLabel(project.currentStage)}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((stage) => (
                        <div
                          key={stage}
                          className={`h-2 flex-1 rounded-full ${
                            stage <= project.currentStage ? "bg-primary" : "bg-muted"
                          }`}
                        />
                      ))}
                    </div>
                  </CardContent>
                </div>
                <div className="border-t px-6 py-3 flex items-center justify-end gap-2 bg-muted/30">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingProject(project);
                      setEditedName(project.title);
                    }}
                    data-testid={`button-edit-${project.id}`}
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setProjectToDelete(project);
                    }}
                    data-testid={`button-delete-${project.id}`}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="text-center py-12">
            <CardContent className="space-y-4">
              <img src={logoUrl} alt="Patent Geyser" className="h-20 w-20 mx-auto opacity-50" />
              <div className="space-y-2">
                <h3 className="text-xl font-semibold">No projects yet</h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Get started by creating your first patent application project. Our AI-powered agents
                  will guide you through every step.
                </p>
              </div>
              <Button
                size="lg"
                data-testid="button-create-first-project"
                onClick={() => setShowCreateDialog(true)}
              >
                <Plus className="h-5 w-5 mr-2" />
                Create Your First Project
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Create Project Dialog */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent data-testid="dialog-create-project">
            <DialogHeader>
              <DialogTitle>Create New Patent Project</DialogTitle>
              <DialogDescription>
                Give your patent application a descriptive name to help you identify it later.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="project-name">Project Name</Label>
                <Input
                  id="project-name"
                  data-testid="input-project-name"
                  placeholder="e.g., AI-Powered Blockchain Trading System"
                  value={newProjectName}
                  onChange={(e) => {
                    setNewProjectName(e.target.value);
                    if (createNameError) setCreateNameError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !createProjectMutation.isPending) {
                      if (!newProjectName.trim()) {
                        setCreateNameError("Project name is required");
                        return;
                      }
                      createProjectMutation.mutate();
                    }
                  }}
                />
                {createNameError && (
                  <p className="text-sm text-destructive" data-testid="error-project-name">
                    {createNameError}
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreateDialog(false);
                  setNewProjectName("");
                  setCreateNameError("");
                }}
                disabled={createProjectMutation.isPending}
                data-testid="button-cancel-create"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (!newProjectName.trim()) {
                    setCreateNameError("Project name is required");
                    return;
                  }
                  createProjectMutation.mutate();
                }}
                disabled={createProjectMutation.isPending}
                data-testid="button-confirm-create"
              >
                {createProjectMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Project"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Buy Credits Dialog (embedded GHL order form) */}
        {(() => {
          const open = buyDialogOpen || !!limitInfo;
          const embedUrl = limitInfo?.embedUrl ?? user?.embedUrl ?? null;
          const close = () => { setBuyDialogOpen(false); setLimitInfo(null); };
          return (
            <Dialog open={open} onOpenChange={(v) => !v && close()}>
              <DialogContent
                data-testid="dialog-buy-credits"
                className="max-w-5xl w-[95vw] sm:w-[90vw] max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden"
              >
                <DialogHeader className="p-6 pb-3 shrink-0">
                  <DialogTitle>{limitInfo ? "You're out of credits" : "Buy project credits"}</DialogTitle>
                  <DialogDescription>
                    {limitInfo
                      ? `You've used ${limitInfo.creditsUsed} of ${limitInfo.credits} credit${limitInfo.credits === 1 ? "" : "s"}. Purchase more to create another project.`
                      : "Each credit lets you create one project. Single or 5-pack bundle available."}
                  </DialogDescription>
                </DialogHeader>
                {/* Fixed beige background so the GHL form (designed for a light neutral) renders
                    correctly in both light and dark app themes. */}
                <div className="flex-1 overflow-auto bg-[#f5efe4] p-4">
                  {embedUrl ? (
                    <iframe
                      src={embedUrl}
                      title="Payment Form Patent Credits"
                      className="w-full min-h-[70vh] border-none bg-transparent block"
                    />
                  ) : (
                    <p className="text-sm text-neutral-700">
                      Order form not yet configured. Please contact support.
                    </p>
                  )}
                </div>
                <DialogFooter className="p-4 shrink-0 border-t">
                  <Button variant="outline" onClick={close}>Close</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          );
        })()}

        {/* Edit Project Dialog */}
        <Dialog open={!!editingProject} onOpenChange={(open) => {
          if (!open && !updateProjectMutation.isPending) {
            setEditingProject(null);
            setEditedName("");
          }
        }}>
          <DialogContent data-testid="dialog-edit-project">
            <DialogHeader>
              <DialogTitle>Edit Project Name</DialogTitle>
              <DialogDescription>
                Update the name of your patent application project.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-project-name">Project Name</Label>
                <Input
                  id="edit-project-name"
                  data-testid="input-edit-project-name"
                  placeholder="Enter project name"
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !updateProjectMutation.isPending && editingProject && editedName.trim()) {
                      updateProjectMutation.mutate({
                        projectId: editingProject.id,
                        title: editedName,
                      });
                    }
                  }}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setEditingProject(null);
                  setEditedName("");
                }}
                disabled={updateProjectMutation.isPending}
                data-testid="button-cancel-edit"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (editingProject) {
                    updateProjectMutation.mutate({
                      projectId: editingProject.id,
                      title: editedName,
                    });
                  }
                }}
                disabled={updateProjectMutation.isPending || !editedName.trim()}
                data-testid="button-confirm-edit"
              >
                {updateProjectMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Changes"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog 
          open={!!projectToDelete} 
          onOpenChange={(open) => {
            if (!open && !deleteProjectMutation.isPending) {
              setProjectToDelete(null);
            }
          }}
        >
          <AlertDialogContent data-testid="dialog-delete-project">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Project</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  <p>
                    Are you sure you want to delete "{projectToDelete?.title}"? This action cannot be undone
                    and will permanently remove all associated data.
                  </p>
                  {projectToDelete && projectToDelete.currentStage >= 5 && (
                    <p className="font-medium text-destructive">
                      This project has reached the final stage. All of its data will be permanently
                      erased and your credit will not be refunded.
                    </p>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel 
                data-testid="button-cancel-delete"
                disabled={deleteProjectMutation.isPending}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                data-testid="button-confirm-delete"
                onClick={(e) => {
                  e.preventDefault();
                  if (projectToDelete && !deleteProjectMutation.isPending) {
                    deleteProjectMutation.mutate(projectToDelete.id);
                  }
                }}
                disabled={deleteProjectMutation.isPending}
                className="bg-destructive hover:bg-destructive/90"
              >
                {deleteProjectMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  "Delete"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </div>
  );
}
