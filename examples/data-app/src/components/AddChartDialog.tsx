import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Alert,
  Box,
  Stack,
  Typography,
  Link,
  TextField,
  Breadcrumbs,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  Models,
  Packages,
  createEmbeddedQueryResult,
  ModelExplorer,
  encodeResourceUri,
  parseResourceUri,
  artifactFromExplorer,
  slugifyDashboardName,
  sourceNameFromMalloy,
} from "@malloy-publisher/sdk";
import { QueryExplorerResult } from "@malloy-publisher/sdk/dist/components/Model/SourcesExplorer";
import "@malloydata/malloy-explorer/styles.css";

export interface AddChartDialogProps {
  handleAddWidget: (newTitle: string, newQuery: string) => void;
  onClose: () => void;
  resourceUri: string;
}
export default function AddChartDialog({
  handleAddWidget,
  onClose,
  resourceUri,
}: AddChartDialogProps) {
  const defaultValues = parseResourceUri(resourceUri);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showModelExplorer, setShowModelExplorer] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<string>(
    defaultValues.packageName || ""
  );
  const [selectedModel, setSelectedModel] = useState<string>(
    defaultValues.modelPath || ""
  );
  const [modelQuery, setModelQuery] = useState<string>("");
  const [rawMalloy, setRawMalloy] = useState("");
  const [malloyQuery, setMalloyQuery] = useState<
    QueryExplorerResult["malloyQuery"]
  >(undefined);
  const [newTitle, setNewTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [seedQuery, setSeedQuery] = useState<QueryExplorerResult | undefined>();
  const [packetText, setPacketText] = useState("");

  const [currentStep, setCurrentStep] = useState<
    "package" | "model" | "explorer"
  >("package");

  // Navigate function for package selection
  const handlePackageNavigate = (to: string, event?: React.MouseEvent) => {
    if (event) {
      event.preventDefault();
    }
    // Parse package name from navigation path (e.g., "storefront/" -> "storefront")
    const packageName = to.replace(/\/$/, "");
    setSelectedPackage(packageName);
    setSelectedModel(""); // Reset model selection when package changes
    setModelQuery(""); // Reset model query
    setShowModelExplorer(false);
    setCurrentStep("model"); // Move to model selection step
  };

  // Navigate function for model selection
  const handleModelNavigate = (to: string, event?: React.MouseEvent) => {
    if (event) {
      event.preventDefault();
    }
    // The 'to' parameter should be the model path
    setSelectedModel(to);
    setShowModelExplorer(true);
    setCurrentStep("explorer"); // Move to explorer step
  };

  // Breadcrumb navigation functions
  const handleBreadcrumbClick = (step: "package" | "model" | "explorer") => {
    if (step === "package") {
      setCurrentStep("package");
      setSelectedPackage("");
      setSelectedModel("");
      setModelQuery("");
      setShowModelExplorer(false);
    } else if (step === "model") {
      setCurrentStep("model");
      setSelectedModel("");
      setModelQuery("");
      setShowModelExplorer(false);
    }
  };

  // Handler for when the Model component query changes
  const handleModelQueryChange = (queryResult: QueryExplorerResult) => {
    if (!selectedModel || !selectedPackage) {
      console.log(
        `no model or package selected. model: ${selectedModel} package: ${selectedPackage}`
      );
      return;
    }
    if (!queryResult.query) {
      setModelQuery("");
      setRawMalloy("");
      setMalloyQuery(undefined);
      return;
    }
    setRawMalloy(queryResult.query);
    setMalloyQuery(queryResult.malloyQuery);

    const newResourceUri = encodeResourceUri({
      environmentName: defaultValues.environmentName,
      packageName: selectedPackage,
      modelPath: selectedModel,
    });

    const queryResultString = createEmbeddedQueryResult({
      query: queryResult.query || "",
      resourceUri: newResourceUri,
    });
    setModelQuery(queryResultString);
  };

  // Construct URIs for components based on selection
  const getPackageResourceUri = () => {
    if (!selectedPackage) return resourceUri;
    return encodeResourceUri({
      environmentName: defaultValues.environmentName,
      packageName: selectedPackage,
    });
  };

  const getModelResourceUri = () => {
    if (!selectedPackage || !selectedModel) return resourceUri;
    return encodeResourceUri({
      environmentName: defaultValues.environmentName,
      packageName: selectedPackage,
      modelPath: selectedModel,
    });
  };

  return (
    <Dialog
      open={true}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      sx={{
        zIndex: 50,
      }}
      PaperProps={{
        sx: {
          minHeight: "80vh",
          maxHeight: "90vh",
        },
      }}
    >
      <DialogTitle>Add Embedded Chart</DialogTitle>

      <DialogContent>
        <Stack spacing={3}>
          {/* Breadcrumb Navigation */}
          <Breadcrumbs separator=">" sx={{ mb: 2 }}>
            <Link
              component="button"
              variant="body2"
              onClick={() => handleBreadcrumbClick("package")}
              sx={{
                textDecoration: "none",
                fontWeight: currentStep === "package" ? "bold" : "normal",
                color: "primary.main",
              }}
            >
              Select Package
            </Link>
            {(currentStep === "model" || currentStep === "explorer") && (
              <Link
                component="button"
                variant="body2"
                onClick={() => handleBreadcrumbClick("model")}
                sx={{
                  textDecoration: "none",
                  fontWeight: currentStep === "model" ? "bold" : "normal",
                  color: "primary.main",
                }}
              >
                {selectedPackage}
              </Link>
            )}
            {currentStep === "explorer" && (
              <Typography
                variant="body2"
                color="primary.main"
                sx={{ fontWeight: "bold" }}
              >
                {selectedModel}
              </Typography>
            )}
          </Breadcrumbs>

          {/* Package Selection Step */}
          {currentStep === "package" && (
            <Box
              sx={{
                maxHeight: 500,
                overflow: "auto",
                border: "1px solid #e0e0e0",
                borderRadius: 1,
              }}
            >
              <Packages
                resourceUri={resourceUri}
                onSelectPackage={handlePackageNavigate}
              />
            </Box>
          )}

          {/* Model Selection Step */}
          {currentStep === "model" && selectedPackage && (
            <Box>
              <Box
                sx={{
                  maxHeight: 500,
                  overflow: "auto",
                  border: "1px solid #e0e0e0",
                  borderRadius: 1,
                }}
              >
                <Models
                  onClickModelFile={handleModelNavigate}
                  resourceUri={getPackageResourceUri()}
                />
              </Box>
            </Box>
          )}

          {/* Model Explorer Step */}
          {currentStep === "explorer" && selectedPackage && selectedModel && (
            <Box>
              <TextField
                label="Chart title (optional)"
                fullWidth
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                sx={{ mb: 2 }}
              />

              <Box
                sx={{
                  border: "1px solid #e0e0e0",
                  borderRadius: 2,
                  minHeight: 400,
                  overflow: "auto",
                }}
              >
                <ModelExplorer
                  resourceUri={getModelResourceUri()}
                  existingQuery={seedQuery}
                  onChange={handleModelQueryChange}
                />
                <Accordion
                  disableGutters
                  elevation={0}
                  sx={{
                    mt: 1,
                    borderTop: "1px solid #e0e0e0",
                    "&:before": { display: "none" },
                  }}
                >
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="caption" color="text.secondary">
                      Query packet (copy to an agent, or paste one back)
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <TextField
                      multiline
                      minRows={3}
                      fullWidth
                      value={packetText}
                      onChange={(e) => setPacketText(e.target.value)}
                      spellCheck={false}
                      placeholder='{"malloy":"run: orders -> { aggregate: order_count }"}'
                    />
                    <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                      <Button
                        size="small"
                        onClick={() => {
                          const sourceName = sourceNameFromMalloy(rawMalloy);
                          const packet = {
                            sourceName,
                            modelPath: selectedModel,
                            query:
                              malloyQuery && typeof malloyQuery === "object"
                                ? malloyQuery
                                : undefined,
                            malloy: rawMalloy,
                            mode:
                              typeof malloyQuery === "string"
                                ? "source"
                                : "visual",
                          };
                          const text = JSON.stringify(packet, null, 2);
                          setPacketText(text);
                          void navigator.clipboard?.writeText(text);
                        }}
                        disabled={!rawMalloy}
                      >
                        Copy query packet
                      </Button>
                      <Button
                        size="small"
                        onClick={() => {
                          try {
                            const packet = JSON.parse(packetText) as {
                              malloy?: string;
                              query?: QueryExplorerResult["malloyQuery"];
                              mode?: "visual" | "source";
                            };
                            if (!packet.malloy && !packet.query) {
                              setErrorMessage("Packet needs malloy or query.");
                              return;
                            }
                            const next: QueryExplorerResult = {
                              query: packet.malloy,
                              malloyQuery:
                                packet.mode === "visual" && packet.query
                                  ? packet.query
                                  : packet.malloy,
                              malloyResult: undefined,
                            };
                            setSeedQuery(next);
                            setRawMalloy(packet.malloy ?? "");
                            setMalloyQuery(next.malloyQuery);
                            setErrorMessage(null);
                          } catch (err) {
                            setErrorMessage(`Invalid packet: ${String(err)}`);
                          }
                        }}
                        disabled={!packetText.trim()}
                      >
                        Apply packet
                      </Button>
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              </Box>
            </Box>
          )}

          {errorMessage && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {errorMessage}
            </Alert>
          )}
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={async () => {
            const malloy = rawMalloy.trim();
            if (!malloy) {
              setErrorMessage("Run a query first.");
              return;
            }
            const sourceName = sourceNameFromMalloy(malloy);
            if (!sourceName) {
              setErrorMessage("Could not read a source name from the query.");
              return;
            }
            const title = newTitle.trim() || sourceName;
            const slug = slugifyDashboardName(title);
            setSaving(true);
            setErrorMessage(null);
            try {
              const source = artifactFromExplorer({
                malloy,
                sourceName,
                modelPath: selectedModel,
                title,
                slug,
              });
              const res = await fetch(
                `/api/v0/environments/${defaultValues.environmentName}/packages/${selectedPackage}/dashboards/${slug}/source`,
                {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ source }),
                },
              );
              if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as {
                  message?: string;
                };
                throw new Error(body.message || res.statusText);
              }
              onClose();
            } catch (err) {
              setErrorMessage(`Save as dashboard failed: ${String(err)}`);
            } finally {
              setSaving(false);
            }
          }}
          disabled={!rawMalloy || saving}
        >
          {saving ? "Saving…" : "Save as dashboard"}
        </Button>
        <Button
          variant="contained"
          onClick={() => handleAddWidget(newTitle, modelQuery)}
          disabled={!modelQuery}
        >
          Add
        </Button>
      </DialogActions>
    </Dialog>
  );
}
