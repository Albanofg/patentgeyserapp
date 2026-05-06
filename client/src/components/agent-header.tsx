import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Home, ChevronLeft, ChevronRight } from "lucide-react";
import type { Project } from "@shared/schema";

// Full linear workflow sequence (sidebar order)
const WORKFLOW_STEPS = [
  { id: '1a', stage: 1 },
  { id: '1b', stage: 1 },
  { id: '2a', stage: 2 },
  { id: '2b', stage: 2 },
  { id: '3',  stage: 3 },
  { id: '4a', stage: 4 },
  { id: '4b', stage: 4 },
  { id: '4-conception', stage: 4 },
  { id: '5',  stage: 5 },
  { id: '5-practitioner', stage: 5 },
];

const STAGE_NAMES = [
  "Intake & Screening",
  "Refinement Workshop",
  "Prior Art Research",
  "White Space Analysis",
  "The Showcase",
];

interface AgentHeaderProps {
  project: Project;
  agentNumber: number;
  agentName: string;
  agentDescription: string;
  prevRoute?: string;
  nextRoute?: string;
}

export function AgentHeader({
  project,
  agentNumber,
  agentName,
  agentDescription,
  prevRoute,
  nextRoute,
}: AgentHeaderProps) {
  const [location, setLocation] = useLocation();

  // Detect current step from URL (e.g. "/project/abc/agent/4-conception" → "4-conception")
  const stepMatch = location.match(/\/agent\/([^/]+)$/);
  const currentStepId = stepMatch?.[1] ?? String(agentNumber);
  const currentIndex = WORKFLOW_STEPS.findIndex((s) => s.id === currentStepId);

  // Compute prev
  const prevStep = currentIndex > 0 ? WORKFLOW_STEPS[currentIndex - 1] : null;
  const computedPrevRoute = prevStep ? `/project/${project?.id}/agent/${prevStep.id}` : null;

  // Compute next — only allow if that step's stage <= currentStage (already reached)
  const nextStep = currentIndex < WORKFLOW_STEPS.length - 1 ? WORKFLOW_STEPS[currentIndex + 1] : null;
  const nextReached = nextStep && nextStep.stage <= (project?.currentStage ?? 0);
  const computedNextRoute = nextReached ? `/project/${project?.id}/agent/${nextStep.id}` : null;

  // Props override computed values (pass empty string "" to explicitly disable)
  const backRoute  = prevRoute  !== undefined ? (prevRoute  || null) : computedPrevRoute;
  const forwardRoute = nextRoute !== undefined ? (nextRoute || null) : computedNextRoute;

  return (
    <div className="border-b bg-card">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 mb-3 sm:mb-4">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm overflow-x-auto">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 sm:h-8 px-2 sm:px-3 flex-shrink-0"
              data-testid="button-back-dashboard"
              onClick={() => setLocation("/")}
            >
              <Home className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
              <span className="hidden sm:inline">Dashboard</span>
            </Button>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium truncate max-w-[100px] sm:max-w-[200px]">{project?.title}</span>
            <span className="text-muted-foreground">/</span>
            <span className="text-muted-foreground whitespace-nowrap">Agent {agentNumber}</span>
          </div>

          {/* Previous / Next */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="h-7 sm:h-8 px-2 sm:px-3"
              data-testid="button-previous-agent"
              onClick={() => backRoute && setLocation(backRoute)}
              disabled={!backRoute}
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden sm:inline ml-1">Previous</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 sm:h-8 px-2 sm:px-3"
              data-testid="button-next-agent"
              onClick={() => forwardRoute && setLocation(forwardRoute)}
              disabled={!forwardRoute}
            >
              <span className="hidden sm:inline mr-1">Next</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-2 sm:space-y-3">
          <div>
            <h1 className="text-xl sm:text-3xl font-bold leading-tight">{agentName}</h1>
            <p className="text-muted-foreground text-sm sm:text-base mt-1">{agentDescription}</p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs sm:text-sm font-medium text-muted-foreground hidden sm:inline">Progress:</span>
            <div className="flex gap-1 flex-1 max-w-md">
              {[1, 2, 3, 4, 5].map((stage) => (
                <div
                  key={stage}
                  className={`h-1.5 sm:h-2 flex-1 rounded-full ${
                    stage < agentNumber
                      ? "bg-primary"
                      : stage === agentNumber
                        ? "bg-primary animate-pulse"
                        : "bg-muted"
                  }`}
                  title={STAGE_NAMES[stage - 1]}
                />
              ))}
            </div>
            <span className="text-xs sm:text-sm font-medium whitespace-nowrap">
              {agentNumber} of 5
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
