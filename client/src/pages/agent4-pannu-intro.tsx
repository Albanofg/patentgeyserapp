import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AgentHeader } from "@/components/agent-header";
import { Loader2, Shield, SkipForward, Brain, FileCheck, Scale, FileText, CheckCircle2, Circle, ArrowRight } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { Project } from "@shared/schema";

export default function Agent4PannuIntro() {
  const [, params] = useRoute("/project/:id/agent/4-pannu-intro");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const projectId = params?.id;
  const [isGenerating, setIsGenerating] = useState(false);
  const [visibleSteps, setVisibleSteps] = useState(0);

  const PROCESSING_STEPS = [
    "Understanding invention description",
    "Identifying core components",
    "Generating example embodiments",
    "Expanding technical descriptions",
    "Organizing specification sections",
    "Formatting draft document",
  ];

  const { data: project, isLoading: projectLoading } = useQuery<Project>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId,
  });

  const skipPannuMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/projects/${projectId}/finalize-provisional`, {});
      return response;
    },
    onMutate: () => {
      setIsGenerating(true);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
      toast({
        title: "Provisional ready!",
        description: "Your provisional patent is ready. You can generate diagrams from The Showcase.",
      });
      setLocation(`/project/${projectId}/agent/5`);
    },
    onError: (error: Error) => {
      setIsGenerating(false);
      toast({
        title: "Generation failed",
        description: error.message,
      });
    },
  });

  useEffect(() => {
    if (!isGenerating) {
      setVisibleSteps(0);
      return;
    }
    if (visibleSteps >= PROCESSING_STEPS.length) return;
    const timer = setTimeout(() => {
      setVisibleSteps((prev) => prev + 1);
    }, 20000);
    return () => clearTimeout(timer);
  }, [isGenerating, visibleSteps]);

  if (projectLoading || !project) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isGenerating) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="max-w-md w-full mx-4 space-y-4">
          <Card>
            <CardContent className="pt-8 pb-8">
              <div className="flex flex-col items-center text-center space-y-6">
                <div className="relative">
                  <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
                    <FileText className="h-10 w-10 text-primary" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full bg-background border-2 border-primary flex items-center justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  </div>
                </div>

                <h2 className="text-xl font-semibold">Processing your invention details</h2>

                <p className="text-muted-foreground text-sm">
                  Our AI is organizing the invention details you provided into a structured draft document for your review and editing.
                </p>

                <div className="w-full text-left space-y-2">
                  {PROCESSING_STEPS.map((step, i) => (
                    <div
                      key={step}
                      className="flex items-center gap-2 transition-all duration-500 ease-out"
                      style={{
                        opacity: i < visibleSteps ? 1 : 0.55,
                        transform: i < visibleSteps ? "translateY(0) scale(1)" : "translateY(4px) scale(0.95)",
                      }}
                    >
                      {i < visibleSteps ? (
                        <CheckCircle2
                          className="h-4 w-4 flex-shrink-0 transition-colors duration-500 text-green-600 dark:text-green-400"
                        />
                      ) : (
                        <Circle
                          className="h-4 w-4 flex-shrink-0 transition-colors duration-500 text-muted-foreground"
                        />
                      )}
                      <span className={`text-sm transition-colors duration-500 ${
                        i < visibleSteps ? "text-foreground" : "text-muted-foreground"
                      }`}>
                        {step}
                      </span>
                    </div>
                  ))}
                </div>

                <p className="text-sm text-muted-foreground pt-2">
                  Your downloadable .docx draft will be ready shortly.
                </p>
              </div>
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground text-center px-4">
            Geyser™ provisional drafting software helps inventors prepare their own patent application drafts. It does not provide legal advice.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AgentHeader
        project={project}
        agentNumber={4}
        agentName="Proof of Human Conception - Introduction"
        agentDescription="Understand the inventorship validation process before you begin"
      />

      <main className="container max-w-5xl mx-auto px-6 py-8">
        <div className="space-y-6">
          {/* Introduction Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Shield className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-2xl">Inventorship Validation (Proof of Human Conception)</CardTitle>
                  <CardDescription>
                    Validate your contribution to the invention under USPTO requirements
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="prose prose-sm max-w-none">
                <p className="text-base text-foreground">
                  Before finalizing your provisional patent, it's important to validate that you meet the USPTO's 
                  legal requirements for inventorship. The <strong>Proof of Human Conception</strong> is a three-factor framework 
                  used by courts and patent examiners to determine true inventorship.
                </p>
              </div>

              {/* What is Proof of Human Conception */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Scale className="h-5 w-5 text-primary" />
                  What is Proof of Human Conception?
                </h3>
                <p className="text-sm text-muted-foreground">
                  Proof of Human Conception is a three-factor framework based on the landmark case <em>Pannu v. Iolab Corp.</em> (1998) 
                  that establishes three criteria for determining who qualifies as an inventor:
                </p>
                
                <div className="grid gap-4 md:grid-cols-3">
                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2">
                        <Brain className="h-5 w-5 text-primary" />
                        <CardTitle className="text-sm">Conception</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        Did you contribute to the conception of the invention? 
                        This means forming the complete idea in your mind.
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5 text-primary" />
                        <CardTitle className="text-sm">Quality of Contribution</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        Was your contribution significant and not merely following instructions or 
                        performing routine work?
                      </p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2">
                        <FileCheck className="h-5 w-5 text-primary" />
                        <CardTitle className="text-sm">Beyond Known Concepts</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        Did your contribution go beyond what was already known or obvious to someone 
                        skilled in the field?
                      </p>
                    </CardContent>
                  </Card>
                </div>
              </div>

              {/* What You'll Need to Do */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">What You'll Need to Do</h3>
                <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <Badge variant="outline" className="mt-0.5">1</Badge>
                    <div>
                      <p className="text-sm font-medium">Answer Questions for Each Claim</p>
                      <p className="text-sm text-muted-foreground">
                        For each independent claim in your patent, you'll answer three specific questions 
                        about your contribution - one for each Pannu factor.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Badge variant="outline" className="mt-0.5">2</Badge>
                    <div>
                      <p className="text-sm font-medium">Use AI Assistance (Optional)</p>
                      <p className="text-sm text-muted-foreground">
                        If you need help formulating your answers, you can click "Ask AI" to get 
                        suggestions based on your claim and the specific question.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Badge variant="outline" className="mt-0.5">3</Badge>
                    <div>
                      <p className="text-sm font-medium">Receive Validation</p>
                      <p className="text-sm text-muted-foreground">
                        Once submitted, the AI will analyze your answers and provide a certification 
                        status with a confidence score and detailed feedback.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Why It Matters */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Why It Matters</h3>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <p className="text-sm">
                      <strong>Accurate Inventorship:</strong> Accurate inventorship documentation in your draft helps satisfy USPTO disclosure requirements and supports practitioner review.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <p className="text-sm">
                      <strong>USPTO Compliance:</strong> The USPTO requires accurate inventorship disclosure. 
                      Errors can lead to patent rejection or invalidation.
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <p className="text-sm">
                      <strong>Ownership Clarity:</strong> Clear documentation prevents disputes about who 
                      owns the rights to the invention.
                    </p>
                  </div>
                </div>
              </div>

              {/* Time Estimate */}
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Loader2 className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                      Estimated Time: 10-15 minutes
                    </p>
                    <p className="text-sm text-blue-700 dark:text-blue-300">
                      The process is straightforward and AI-assisted. You'll have help every step of the way.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="flex items-center justify-between gap-4 pt-4">
            <Button
              variant="outline"
              onClick={() => setLocation(`/project/${projectId}/agent/4b`)}
              data-testid="button-back"
            >
              Back to Claims
            </Button>

            <div className="flex items-center gap-3">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={skipPannuMutation.isPending}
                    data-testid="button-skip-pannu-intro"
                  >
                    {skipPannuMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Skipping...
                      </>
                    ) : (
                      <>
                        <SkipForward className="h-4 w-4 mr-2" />
                        Skip This Step
                      </>
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Skip Inventorship Validation?</AlertDialogTitle>
                    <AlertDialogDescription className="space-y-2">
                      <p>
                        The Pannu test helps validate your inventorship contribution under USPTO requirements. 
                        Skipping this step means you won't have documentation of your inventorship.
                      </p>
                      <p className="font-medium text-foreground">
                        You can continue without completing this validation, but completing it produces more accurate inventorship documentation in your draft.
                      </p>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="button-cancel-skip-intro">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => skipPannuMutation.mutate()}
                      data-testid="button-confirm-skip-intro"
                    >
                      Skip and Continue
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <Button
                variant="default"
                size="lg"
                onClick={() => setLocation(`/project/${projectId}/agent/4-pannu`)}
                data-testid="button-start-pannu"
              >
                Start Proof of Human Conception
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
