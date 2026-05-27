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
import { FileText, Plus, Loader2, Trash2, Edit, FolderPlus, FolderOpen, MoreVertical } from "lucide-react";
import type { Project } from "@shared/schema";
import logoUrl from "@/assets/geyser-logo.png";
import { FamilyCard, type FamilyRow } from "@/components/family-card";
import { PatentDetailsDialog, type PatentDetailsValues } from "@/components/patent-details-dialog";

interface FamilyApi extends FamilyRow {}

interface AuthUser {
  id: string;
  email: string;
  kind: "legacy" | "paid";
  credits?: number;
  creditsUsed?: number;
  creditsRemaining?: number;
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
  }>(null);
  const [buyDialogOpen, setBuyDialogOpen] = useState(false);

  // Family state
  const [showCreateFamilyDialog, setShowCreateFamilyDialog] = useState(false);
  const [newFamilyTitle, setNewFamilyTitle] = useState("");
  const [newFamilyDescription, setNewFamilyDescription] = useState("");
  const [renamingFamily, setRenamingFamily] = useState<FamilyApi | null>(null);
  const [renameFamilyTitle, setRenameFamilyTitle] = useState("");
  const [familyToDelete, setFamilyToDelete] = useState<FamilyApi | null>(null);
  // When set, the New Project dialog will attach the new project to this family
  const [createInFamilyId, setCreateInFamilyId] = useState<string | null>(null);
  // Move-to-family flow: which project is being moved
  const [movingProject, setMovingProject] = useState<Project | null>(null);
  const [moveTargetFamilyId, setMoveTargetFamilyId] = useState<string>("");
  // Bulk-add: target family + selected loose project ids
  const [bulkAddFamilyId, setBulkAddFamilyId] = useState<string | null>(null);
  const [bulkAddSelected, setBulkAddSelected] = useState<Set<string>>(new Set());
  const [bulkAddFilter, setBulkAddFilter] = useState("");

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

  const { data: families } = useQuery<FamilyApi[]>({
    queryKey: ["/api/families"],
    enabled: !!user,
  });

  // Group projects by family — single pass.
  const { looseProjects, projectsByFamily } = (() => {
    const loose: Project[] = [];
    const byFam = new Map<string, Project[]>();
    for (const p of projects ?? []) {
      const fid = (p as any).familyId ?? null;
      if (fid) {
        const arr = byFam.get(fid) ?? [];
        arr.push(p);
        byFam.set(fid, arr);
      } else {
        loose.push(p);
      }
    }
    return { looseProjects: loose, projectsByFamily: byFam };
  })();

  const createFamilyMutation = useMutation<FamilyApi>({
    mutationFn: async () => {
      const title = newFamilyTitle.trim();
      if (!title) throw new Error("Family name is required");
      return await apiRequest<FamilyApi>("POST", "/api/families", {
        title,
        description: newFamilyDescription.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/families"] });
      setShowCreateFamilyDialog(false);
      setNewFamilyTitle("");
      setNewFamilyDescription("");
      toast({ title: "Family created" });
    },
    onError: (err: Error) => toast({ title: "Failed to create family", description: err.message }),
  });

  const renameFamilyMutation = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      return await apiRequest("PATCH", `/api/families/${id}`, { title });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/families"] });
      setRenamingFamily(null);
      toast({ title: "Family renamed" });
    },
    onError: (err: Error) => toast({ title: "Failed to rename family", description: err.message }),
  });

  const deleteFamilyMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/families/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/families"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setFamilyToDelete(null);
      toast({ title: "Family deleted — Projects kept" });
    },
    onError: (err: Error) => toast({ title: "Failed to delete family", description: err.message }),
  });

  const attachProjectMutation = useMutation({
    mutationFn: async ({ projectId, familyId }: { projectId: string; familyId: string }) => {
      return await apiRequest("POST", `/api/projects/${projectId}/family`, { familyId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      setMovingProject(null);
      setMoveTargetFamilyId("");
      toast({ title: "Project moved to family" });
    },
    onError: (err: Error) => toast({ title: "Failed to move Project", description: err.message }),
  });

  const bulkAttachMutation = useMutation({
    mutationFn: async ({ familyId, projectIds }: { familyId: string; projectIds: string[] }) => {
      return await apiRequest<{ attached: string[]; failed: any[]; skipped: string[] }>(
        "POST",
        `/api/families/${familyId}/attach-projects`,
        { projectIds },
      );
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/families"] });
      setBulkAddFamilyId(null);
      setBulkAddSelected(new Set());
      setBulkAddFilter("");
      const n = data?.attached?.length ?? 0;
      const failed = (data?.failed?.length ?? 0) + (data?.skipped?.length ?? 0);
      toast({
        title: failed > 0 ? `Moved ${n} Project${n === 1 ? "" : "s"} (${failed} skipped)` : `Moved ${n} Project${n === 1 ? "" : "s"} to family`,
      });
    },
    onError: (err: Error) => toast({ title: "Failed to move Projects", description: err.message }),
  });

  const detachProjectMutation = useMutation({
    mutationFn: async (projectId: string) => {
      await apiRequest("DELETE", `/api/projects/${projectId}/family`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project removed from family" });
    },
    onError: (err: Error) => toast({ title: "Failed to remove Project", description: err.message }),
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
        ...(createInFamilyId ? { familyId: createInFamilyId } : {}),
      });
    },
    onSuccess: (newProject) => {
      setCreateInFamilyId(null);
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
    mutationFn: async ({ projectId, patch }: { projectId: string; patch: Record<string, any> }) => {
      return await apiRequest("PATCH", `/api/projects/${projectId}`, patch);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project details updated" });
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
            <img src={logoUrl} alt="Patent Geyser Logo" className="h-10 w-10 sm:h-12 sm:w-12 shrink-0" />
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
            <Button
              data-testid="button-new-family"
              size="default"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setShowCreateFamilyDialog(true)}
            >
              <FolderPlus className="h-5 w-5 mr-2" />
              New Family
            </Button>
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
                onClick={() => { setCreateInFamilyId(null); setShowCreateDialog(true); }}
              >
                <Plus className="h-5 w-5 mr-2" />
                New Project
              </Button>
            )}
          </div>
        </div>

        {/* Families section — collapsible cards above the loose project grid. */}
        {families && families.length > 0 && (
          <div className="space-y-3 mb-8">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Families</h3>
            <div className="space-y-3">
              {families.map((fam) => (
                <FamilyCard
                  key={fam.id}
                  family={fam}
                  members={projectsByFamily.get(fam.id) ?? []}
                  hasLooseProjects={looseProjects.length > 0}
                  getStageLabel={getStageLabel}
                  onOpenProject={(p) => {
                    const sub = p.currentSubstage || "";
                    const subStageDigit = sub ? parseInt(sub, 10) : NaN;
                    const useSubstage = sub && subStageDigit === p.currentStage;
                    setLocation(`/project/${p.id}/agent/${useSubstage ? sub : p.currentStage}`);
                  }}
                  onAddProject={(fid) => {
                    setCreateInFamilyId(fid);
                    setShowCreateDialog(true);
                  }}
                  onAddExistingProjects={(fid) => {
                    setBulkAddFamilyId(fid);
                    setBulkAddSelected(new Set());
                    setBulkAddFilter("");
                  }}
                  onDetachProject={(p) => detachProjectMutation.mutate(p.id)}
                  onRenameFamily={(f) => { setRenamingFamily(f); setRenameFamilyTitle(f.title); }}
                  onDeleteFamily={(f) => setFamilyToDelete(f)}
                  onEditProject={(p) => { setEditingProject(p); setEditedName(p.title); }}
                  onDeleteProject={(p) => setProjectToDelete(p)}
                />
              ))}
            </div>
          </div>
        )}

        {projectsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : looseProjects.length > 0 ? (
          <div>
            {families && families.length > 0 && (
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Standalone Projects</h3>
            )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {looseProjects.map((project) => (
              <Card
                key={project.id}
                className="hover-elevate transition-all flex flex-col"
                data-testid={`card-project-${project.id}`}
              >
                <div 
                  className="cursor-pointer flex-1"
                  onClick={() => {
                    // Substage is only meaningful when its leading digit
                    // matches currentStage. Otherwise it's a stale value
                    // from an earlier stage the user already moved past,
                    // and using it would send them backward.
                    const sub = project.currentSubstage || "";
                    const subStageDigit = sub ? parseInt(sub, 10) : NaN;
                    const useSubstage = sub && subStageDigit === project.currentStage;
                    setLocation(`/project/${project.id}/agent/${useSubstage ? sub : project.currentStage}`);
                  }}
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
                  {families && families.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMovingProject(project);
                        setMoveTargetFamilyId(families[0]?.id ?? "");
                      }}
                      data-testid={`button-move-${project.id}`}
                    >
                      <FolderOpen className="h-4 w-4 mr-2" />
                      Move to family
                    </Button>
                  )}
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
          </div>
        ) : !families || families.length === 0 ? (
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
        ) : null}

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

        {/* Buy Credits Dialog — sends user to the dedicated /buy checkout page. */}
        {(() => {
          const open = buyDialogOpen || !!limitInfo;
          const close = () => { setBuyDialogOpen(false); setLimitInfo(null); };
          return (
            <Dialog open={open} onOpenChange={(v) => !v && close()}>
              <DialogContent data-testid="dialog-buy-credits" className="max-w-md">
                <DialogHeader>
                  <DialogTitle>{limitInfo ? "You're out of credits" : "Buy project credits"}</DialogTitle>
                  <DialogDescription>
                    {limitInfo
                      ? `You've used ${limitInfo.creditsUsed} of ${limitInfo.credits} credit${limitInfo.credits === 1 ? "" : "s"}. Purchase more to create another project.`
                      : "Each credit lets you create one project. Single or 5-pack bundle available."}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={close}>Close</Button>
                  <Button onClick={() => { close(); setLocation("/buy"); }} data-testid="button-go-to-buy">
                    Go to checkout
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          );
        })()}

        {/* Create Family Dialog */}
        <Dialog open={showCreateFamilyDialog} onOpenChange={(open) => {
          if (!open && !createFamilyMutation.isPending) {
            setShowCreateFamilyDialog(false);
            setNewFamilyTitle("");
            setNewFamilyDescription("");
          }
        }}>
          <DialogContent data-testid="dialog-create-family">
            <DialogHeader>
              <DialogTitle>New Family</DialogTitle>
              <DialogDescription>
                Families group related Projects covering the same product so you can see each
                other's content and keep each Project distinct. Each Project stays completely
                independent — no content is shared or merged.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="family-title">Family name</Label>
                <Input
                  id="family-title"
                  data-testid="input-family-title"
                  placeholder="e.g., Patent Geyser product"
                  value={newFamilyTitle}
                  onChange={(e) => setNewFamilyTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !createFamilyMutation.isPending && newFamilyTitle.trim()) {
                      createFamilyMutation.mutate();
                    }
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="family-description">Description (optional)</Label>
                <Input
                  id="family-description"
                  placeholder="What product / domain do these Projects cover?"
                  value={newFamilyDescription}
                  onChange={(e) => setNewFamilyDescription(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateFamilyDialog(false)} disabled={createFamilyMutation.isPending}>Cancel</Button>
              <Button onClick={() => createFamilyMutation.mutate()} disabled={createFamilyMutation.isPending || !newFamilyTitle.trim()} data-testid="button-create-family-confirm">
                {createFamilyMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating…</> : "Create Family"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Rename Family Dialog */}
        <Dialog open={!!renamingFamily} onOpenChange={(open) => {
          if (!open && !renameFamilyMutation.isPending) {
            setRenamingFamily(null);
            setRenameFamilyTitle("");
          }
        }}>
          <DialogContent data-testid="dialog-rename-family">
            <DialogHeader>
              <DialogTitle>Rename Family</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <Label htmlFor="rename-family">Family name</Label>
              <Input
                id="rename-family"
                value={renameFamilyTitle}
                onChange={(e) => setRenameFamilyTitle(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRenamingFamily(null)}>Cancel</Button>
              <Button
                disabled={!renameFamilyTitle.trim() || renameFamilyMutation.isPending}
                onClick={() => renamingFamily && renameFamilyMutation.mutate({ id: renamingFamily.id, title: renameFamilyTitle.trim() })}
              >
                {renameFamilyMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Family AlertDialog */}
        <AlertDialog open={!!familyToDelete} onOpenChange={(open) => { if (!open) setFamilyToDelete(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this family?</AlertDialogTitle>
              <AlertDialogDescription>
                The family label will be removed. The Projects inside stay — they just move back
                to the "Standalone Projects" section. No credits are consumed and no
                provenance is affected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => familyToDelete && deleteFamilyMutation.mutate(familyToDelete.id)}
                disabled={deleteFamilyMutation.isPending}
              >
                {deleteFamilyMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Deleting…</> : "Delete family"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Bulk "Add existing Projects" Dialog — multi-select picker. */}
        <Dialog open={!!bulkAddFamilyId} onOpenChange={(open) => {
          if (!open && !bulkAttachMutation.isPending) {
            setBulkAddFamilyId(null);
            setBulkAddSelected(new Set());
            setBulkAddFilter("");
          }
        }}>
          <DialogContent data-testid="dialog-bulk-add-patents" className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Add existing Projects to this family</DialogTitle>
              <DialogDescription>
                Select Projects that already exist outside this family. Each one stays its own
                independent Project — nothing is merged or copied. Their content becomes
                visible in this family's sibling panels.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-3">
              {looseProjects.length === 0 ? (
                <p className="text-sm text-muted-foreground">No Projects are currently outside a family.</p>
              ) : (
                <>
                  {looseProjects.length > 6 && (
                    <Input
                      placeholder="Filter by title…"
                      value={bulkAddFilter}
                      onChange={(e) => setBulkAddFilter(e.target.value)}
                      data-testid="input-bulk-add-filter"
                    />
                  )}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{bulkAddSelected.size} selected</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="underline hover:text-foreground"
                        onClick={() => {
                          const filtered = looseProjects.filter((p) =>
                            !bulkAddFilter.trim() || p.title.toLowerCase().includes(bulkAddFilter.toLowerCase()),
                          );
                          setBulkAddSelected(new Set(filtered.map((p) => p.id)));
                        }}
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        className="underline hover:text-foreground"
                        onClick={() => setBulkAddSelected(new Set())}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="max-h-90 overflow-y-auto border border-border rounded-md divide-y divide-border">
                    {looseProjects
                      .filter((p) => !bulkAddFilter.trim() || p.title.toLowerCase().includes(bulkAddFilter.toLowerCase()))
                      .map((p) => {
                        const checked = bulkAddSelected.has(p.id);
                        return (
                          <label
                            key={p.id}
                            className="flex items-start gap-3 px-3 py-2.5 hover-elevate cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const next = new Set(bulkAddSelected);
                                if (e.target.checked) next.add(p.id);
                                else next.delete(p.id);
                                setBulkAddSelected(next);
                              }}
                              className="mt-1 flex-none"
                              data-testid={`bulk-add-check-${p.id}`}
                            />
                            <span className="min-w-0 flex-1 flex flex-col gap-1.5">
                              <span className="flex items-center gap-2 min-w-0">
                                <span className="text-sm font-medium truncate">{p.title}</span>
                                {p.completed === 1 && (
                                  <Badge variant="secondary" className="text-[10px] flex-none">Complete</Badge>
                                )}
                              </span>
                              <span className="flex items-center gap-2">
                                <span className="flex gap-1 w-24 flex-none">
                                  {[1, 2, 3, 4, 5].map((stage) => (
                                    <span
                                      key={stage}
                                      className={`h-1 flex-1 rounded-full ${
                                        stage <= p.currentStage ? "bg-primary" : "bg-muted"
                                      }`}
                                    />
                                  ))}
                                </span>
                                <span className="text-[11px] text-muted-foreground">Stage {p.currentStage}</span>
                              </span>
                            </span>
                          </label>
                        );
                      })}
                  </div>
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBulkAddFamilyId(null)}>Cancel</Button>
              <Button
                disabled={bulkAddSelected.size === 0 || bulkAttachMutation.isPending}
                onClick={() => bulkAddFamilyId && bulkAttachMutation.mutate({ familyId: bulkAddFamilyId, projectIds: Array.from(bulkAddSelected) })}
                data-testid="button-bulk-add-confirm"
              >
                {bulkAttachMutation.isPending
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Moving…</>
                  : `Add ${bulkAddSelected.size || ""} Project${bulkAddSelected.size === 1 ? "" : "s"}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Move-to-family Dialog */}
        <Dialog open={!!movingProject} onOpenChange={(open) => {
          if (!open && !attachProjectMutation.isPending) {
            setMovingProject(null);
            setMoveTargetFamilyId("");
          }
        }}>
          <DialogContent data-testid="dialog-move-family">
            <DialogHeader>
              <DialogTitle>Move to family</DialogTitle>
              <DialogDescription>
                Pick a family. Projects in a family share a domain so you can see each other's
                content and stay distinct. Nothing is copied or merged.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              {(families ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No families yet. Create one with "New Family" first.</p>
              ) : (
                <select
                  className="w-full border border-input rounded-md px-2 py-2 bg-background text-sm"
                  value={moveTargetFamilyId}
                  onChange={(e) => setMoveTargetFamilyId(e.target.value)}
                  data-testid="select-move-family"
                >
                  {(families ?? []).map((f) => (
                    <option key={f.id} value={f.id}>{f.title}</option>
                  ))}
                </select>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMovingProject(null)}>Cancel</Button>
              <Button
                disabled={!moveTargetFamilyId || attachProjectMutation.isPending}
                onClick={() => movingProject && moveTargetFamilyId && attachProjectMutation.mutate({ projectId: movingProject.id, familyId: moveTargetFamilyId })}
                data-testid="button-confirm-move-family"
              >
                {attachProjectMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Moving…</> : "Move"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Project Details Dialog — full metadata editor. */}
        <PatentDetailsDialog
          open={!!editingProject}
          onOpenChange={(o) => {
            if (!o && !updateProjectMutation.isPending) {
              setEditingProject(null);
              setEditedName("");
            }
          }}
          showTitle
          mode="project"
          title="Edit Project details"
          description="Every field is optional. Fill in what you know; you can come back later."
          saving={updateProjectMutation.isPending}
          initial={editingProject ? {
            title: editingProject.title,
            inventorNames: (editingProject as any).inventorNames ?? null,
            filedDate: (editingProject as any).filedDate ?? null,
            status: (editingProject as any).status ?? null,
            applicationNumber: (editingProject as any).applicationNumber ?? null,
            publicationNumber: (editingProject as any).publicationNumber ?? null,
            assignee: (editingProject as any).assignee ?? null,
            jurisdiction: (editingProject as any).jurisdiction ?? null,
            patentType: (editingProject as any).patentType ?? null,
            externalUrl: (editingProject as any).externalUrl ?? null,
            notes: (editingProject as any).notes ?? null,
          } : {}}
          onSave={(values: PatentDetailsValues) => {
            if (!editingProject) return;
            updateProjectMutation.mutate({ projectId: editingProject.id, patch: values });
          }}
        />

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
