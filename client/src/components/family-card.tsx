// One row per family on the dashboard. Built to handle families with many
// member Projects: collapsed by default (just title + count + last-updated),
// expands to a scrollable, dense list of member rows. Each row reuses the
// same click-to-open / edit / delete affordances as a loose project.
//
// Heavy keyboard / interaction logic lives on the parent dashboard — this
// component is presentational + emits events upward.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, FolderOpen, MoreVertical, Plus, Edit, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Project } from "@shared/schema";
import { FamilyContextFiles } from "@/components/family-context-files";

// Small portaled dropdown — renders the menu at document.body so it escapes
// the family card's overflow / scroll boundaries, sits on top of every other
// surface, and has a fully opaque background. Pure styling utility; the menu
// items themselves are passed in as children.
function PortalMenu({
  open,
  anchorRef,
  onClose,
  children,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const estimatedWidth = 200;
    const left = Math.min(
      rect.right - estimatedWidth,
      window.innerWidth - estimatedWidth - 8,
    );
    setPos({ top: rect.bottom + 4, left: Math.max(8, left) });
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      if (anchorRef.current && anchorRef.current.contains(e.target as Node)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, anchorRef, onClose]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 1000 }}
      className="min-w-48 rounded-md border border-border bg-card text-card-foreground shadow-xl py-1"
    >
      {children}
    </div>,
    document.body,
  );
}

export interface FamilyRow {
  id: string;
  title: string;
  description: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface Props {
  family: FamilyRow;
  members: Project[];
  hasLooseProjects: boolean;
  onOpenProject: (project: Project) => void;
  onAddProject: (familyId: string) => void;
  onAddExistingProjects: (familyId: string) => void;
  onDetachProject: (project: Project) => void;
  onRenameFamily: (family: FamilyRow) => void;
  onDeleteFamily: (family: FamilyRow) => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  getStageLabel: (stage: number) => string;
}

export function FamilyCard({
  family,
  members,
  hasLooseProjects,
  onOpenProject,
  onAddProject,
  onAddExistingProjects,
  onDetachProject,
  onRenameFamily,
  onDeleteFamily,
  onEditProject,
  onDeleteProject,
  getStageLabel,
}: Props) {
  const [open, setOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchorRef = useRef<HTMLButtonElement | null>(null);
  const memberCount = members.length;

  const lastUpdated = useMemo(() => {
    const dates = members
      .map((m) => (m.updatedAt ? new Date(m.updatedAt).getTime() : 0))
      .filter((n) => n > 0);
    if (dates.length === 0) return null;
    return new Date(Math.max(...dates));
  }, [members]);

  return (
    <div
      className="border border-border rounded-lg bg-card"
      data-testid={`family-card-${family.id}`}
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 min-w-0 hover-elevate active-elevate-2 rounded-md px-2 py-1 -ml-2 flex-1 text-left"
              data-testid={`family-toggle-${family.id}`}
            >
              {open ? <ChevronDown className="h-4 w-4 flex-none" /> : <ChevronRight className="h-4 w-4 flex-none" />}
              <FolderOpen className="h-4 w-4 text-primary flex-none" />
              <span className="font-semibold truncate">{family.title}</span>
              <Badge variant="secondary" className="ml-1 flex-none">{memberCount} Project{memberCount === 1 ? "" : "s"}</Badge>
              {lastUpdated && (
                <span className="text-xs text-muted-foreground flex-none ml-2">
                  updated {lastUpdated.toLocaleDateString()}
                </span>
              )}
            </button>
          </CollapsibleTrigger>
          <div className="flex items-center gap-1 flex-none">
            {hasLooseProjects && (
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); onAddExistingProjects(family.id); }}
                data-testid={`family-add-existing-${family.id}`}
              >
                <FolderOpen className="h-3.5 w-3.5 mr-1" /> Add existing
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => { e.stopPropagation(); onAddProject(family.id); }}
              data-testid={`family-add-${family.id}`}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Project
            </Button>
            <Button
              ref={menuAnchorRef}
              size="sm"
              variant="ghost"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
              data-testid={`family-menu-${family.id}`}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
            <PortalMenu open={menuOpen} anchorRef={menuAnchorRef} onClose={() => setMenuOpen(false)}>
              <button
                className="w-full text-left text-sm px-3 py-2 hover-elevate flex items-center gap-2"
                onClick={() => { setMenuOpen(false); onRenameFamily(family); }}
                data-testid={`family-rename-${family.id}`}
              >
                <Edit className="h-4 w-4" /> Edit title
              </button>
              <button
                className="w-full text-left text-sm px-3 py-2 hover-elevate flex items-center gap-2 text-destructive"
                onClick={() => { setMenuOpen(false); onDeleteFamily(family); }}
                data-testid={`family-delete-${family.id}`}
              >
                <Trash2 className="h-4 w-4" /> Delete family
              </button>
            </PortalMenu>
          </div>
        </div>
        <CollapsibleContent>
          {family.description && (
            <p className="px-4 pb-2 text-xs text-muted-foreground">{family.description}</p>
          )}
          <FamilyContextFiles familyId={family.id} />
          {memberCount === 0 ? (
            <div className="px-4 pb-4 text-sm text-muted-foreground">
              No Projects in this family yet. Click <span className="font-medium">Add Project</span> to create one.
            </div>
          ) : (
            <ScrollArea className="max-h-[400px]">
              <div className="px-2 pb-2 space-y-1">
                {members.map((p) => (
                  <FamilyMemberRow
                    key={p.id}
                    project={p}
                    onOpen={() => onOpenProject(p)}
                    onEdit={() => onEditProject(p)}
                    onDelete={() => onDeleteProject(p)}
                    onDetach={() => onDetachProject(p)}
                    getStageLabel={getStageLabel}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

interface RowProps {
  project: Project;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDetach: () => void;
  getStageLabel: (stage: number) => string;
}

function FamilyMemberRow({ project, onOpen, onEdit, onDelete, onDetach, getStageLabel }: RowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchorRef = useRef<HTMLButtonElement | null>(null);
  return (
    <div
      // Compact on mobile, roomier on desktop so the progress bar reads cleanly.
      className="flex items-center justify-between gap-3 px-2 py-1.5 sm:px-3 sm:py-3 rounded-md hover-elevate"
      data-testid={`family-member-${project.id}`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex items-center gap-3 min-w-0 flex-1 text-left"
        data-testid={`family-member-open-${project.id}`}
      >
        {/* Mobile: keep the tight inline layout (title + stage badge). */}
        <span className="sm:hidden flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate">{project.title}</span>
          <Badge variant="outline" className="text-[10px] flex-none">stage {project.currentStage}{project.completed ? " ✓" : ""}</Badge>
        </span>

        {/* Desktop: bigger title + 5-bar progress indicator + completed chip. */}
        <span className="hidden sm:flex flex-col min-w-0 flex-1 gap-1.5">
          <span className="flex items-center gap-2 min-w-0">
            <span className="text-base font-semibold truncate">{project.title}</span>
            {project.completed === 1 && (
              <Badge variant="secondary" className="text-[10px] flex-none">Complete</Badge>
            )}
            <span className="text-xs text-muted-foreground truncate ml-auto">
              Stage {project.currentStage}: {getStageLabel(project.currentStage)}
            </span>
          </span>
          <span className="flex gap-1 max-w-xs">
            {[1, 2, 3, 4, 5].map((stage) => (
              <span
                key={stage}
                className={`h-1 flex-1 rounded-full ${
                  stage <= project.currentStage ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </span>
        </span>
      </button>
      <div className="flex items-center gap-1 flex-none">
        <Button
          ref={menuAnchorRef}
          size="sm"
          variant="ghost"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
        <PortalMenu open={menuOpen} anchorRef={menuAnchorRef} onClose={() => setMenuOpen(false)}>
          <button
            className="w-full text-left text-sm px-3 py-2 hover-elevate flex items-center gap-2"
            onClick={() => { setMenuOpen(false); onEdit(); }}
          >
            <Edit className="h-4 w-4" /> Edit details
          </button>
          <button
            className="w-full text-left text-sm px-3 py-2 hover-elevate flex items-center gap-2"
            onClick={() => { setMenuOpen(false); onDetach(); }}
          >
            <FolderOpen className="h-4 w-4" /> Remove from family
          </button>
          <button
            className="w-full text-left text-sm px-3 py-2 hover-elevate flex items-center gap-2 text-destructive"
            onClick={() => { setMenuOpen(false); onDelete(); }}
          >
            <Trash2 className="h-4 w-4" /> Delete Project
          </button>
        </PortalMenu>
      </div>
    </div>
  );
}
