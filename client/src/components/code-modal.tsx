import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Code, Upload, Clipboard, Plus, Loader2, Trash2, FileCode, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface SourceCodeFile {
  id: string;
  fileName: string;
  description: string;
  code: string;
  addedAt: string;
}

interface CodeData {
  files: SourceCodeFile[];
  updatedAt: string | null;
}

interface CodeModalProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CodeModal({ projectId, open, onOpenChange }: CodeModalProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [codeText, setCodeText] = useState("");
  const [codeDescription, setCodeDescription] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("paste");

  const { data, isLoading } = useQuery<CodeData>({
    queryKey: ["/api/projects", projectId, "source-code"],
    enabled: !!projectId && open,
  });

  const saveMutation = useMutation({
    mutationFn: async (code: { sourceCode: string; fileName?: string; codeDescription?: string }) => {
      return await apiRequest("POST", `/api/projects/${projectId}/source-code`, code);
    },
    onSuccess: () => {
      toast({
        title: "Code Added",
        description: "Your source code file has been added.",
      });
      setCodeText("");
      setCodeDescription("");
      setFileName(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "source-code"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Save",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteFileMutation = useMutation({
    mutationFn: async (fileId: string) => {
      return await apiRequest("DELETE", `/api/projects/${projectId}/source-code/${fileId}`);
    },
    onSuccess: () => {
      toast({
        title: "File Removed",
        description: "The code file has been removed.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "source-code"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Remove",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setCodeText(content);
      setFileName(file.name);
      setActiveTab("paste");
      toast({
        title: "File Loaded",
        description: `Loaded ${file.name}`,
      });
    };
    reader.onerror = () => {
      toast({
        title: "Failed to Read File",
        description: "Could not read the selected file.",
        variant: "destructive",
      });
    };
    reader.readAsText(file);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setCodeText(text);
        toast({
          title: "Pasted",
          description: "Code pasted from clipboard.",
        });
      }
    } catch (err) {
      toast({
        title: "Unable to Paste",
        description: "Please paste manually using Ctrl+V or Cmd+V",
        variant: "destructive",
      });
    }
  };

  const handleAddCode = () => {
    if (!codeText.trim()) {
      toast({
        title: "No Code",
        description: "Please paste or upload some code first.",
        variant: "destructive",
      });
      return;
    }
    saveMutation.mutate({ 
      sourceCode: codeText, 
      fileName: fileName || undefined,
      codeDescription: codeDescription || undefined,
    });
  };

  const existingFiles = data?.files || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Code className="h-5 w-5 text-primary" />
            Add Custom Code
          </DialogTitle>
          <DialogDescription>
            Add source code files to extract patentable ideas. Each file will be analyzed for novel concepts.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex-1 flex flex-col gap-4 overflow-y-auto">
            {existingFiles.length > 0 && (
              <div className="space-y-2 flex-shrink-0">
                <Label className="text-sm font-medium">Added Code Files ({existingFiles.length})</Label>
                <div className="max-h-[120px] overflow-y-auto rounded-md border p-2 scrollbar-thin">
                  <div className="space-y-2">
                    {existingFiles.map((file) => (
                      <div 
                        key={file.id} 
                        className="flex items-center justify-between gap-2 p-2 bg-muted/50 rounded-md"
                        data-testid={`file-item-${file.id}`}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <FileCode className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{file.fileName}</p>
                            {file.description && (
                              <p className="text-xs text-muted-foreground truncate">{file.description}</p>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 flex-shrink-0"
                          onClick={() => deleteFileMutation.mutate(file.id)}
                          disabled={deleteFileMutation.isPending}
                          data-testid={`button-delete-file-${file.id}`}
                        >
                          {deleteFileMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <X className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="border-t pt-4 flex flex-col">
              <Label className="text-sm font-medium mb-2">Add New Code File</Label>
              
              <div className="space-y-2 mb-3">
                <Label htmlFor="code-description" className="text-xs text-muted-foreground">What does this code do?</Label>
                <Textarea
                  id="code-description"
                  data-testid="input-code-description"
                  placeholder="Describe what your code does, its key functions, and how it relates to your invention..."
                  value={codeDescription}
                  onChange={(e) => setCodeDescription(e.target.value)}
                  className="min-h-[50px] resize-none"
                />
              </div>

              <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="paste" data-testid="tab-paste-code">
                    <Clipboard className="h-4 w-4 mr-2" />
                    Paste Code
                  </TabsTrigger>
                  <TabsTrigger value="upload" data-testid="tab-upload-file">
                    <Upload className="h-4 w-4 mr-2" />
                    Upload File
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="paste" className="flex flex-col mt-3">
                  <div className="flex items-center justify-between mb-2">
                    <Label htmlFor="code-input" className="text-xs text-muted-foreground">Source Code</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handlePaste}
                      data-testid="button-paste-code"
                    >
                      <Clipboard className="h-4 w-4 mr-1" />
                      Paste
                    </Button>
                  </div>
                  <Textarea
                    id="code-input"
                    data-testid="input-source-code"
                    placeholder="Paste your source code here..."
                    value={codeText}
                    onChange={(e) => setCodeText(e.target.value)}
                    className="min-h-[100px] font-mono text-sm resize-none"
                  />
                  {fileName && (
                    <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                      <FileCode className="h-3 w-3" />
                      {fileName}
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="upload" className="mt-3">
                  <div className="border-2 border-dashed rounded-lg p-4 text-center">
                    <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground mb-2">
                      Upload a code file (.js, .ts, .py, .sol, .json, etc.)
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".js,.jsx,.ts,.tsx,.py,.sol,.rs,.go,.java,.cpp,.c,.h,.rb,.php,.swift,.kt,.scala,.sh,.bash,.sql,.json,.yaml,.yml,.toml,.md,.txt"
                      onChange={handleFileUpload}
                      className="hidden"
                      data-testid="input-file-upload"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      data-testid="button-choose-file"
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Choose File
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2 border-t">
              <div className="text-xs text-muted-foreground">
                {existingFiles.length > 0 && `${existingFiles.length} file${existingFiles.length !== 1 ? 's' : ''} added`}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  data-testid="button-done"
                >
                  Done
                </Button>
                <Button
                  onClick={handleAddCode}
                  disabled={saveMutation.isPending || !codeText.trim()}
                  data-testid="button-add-code"
                >
                  {saveMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Code
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
