import { Alert, Box, Button, Stack, TextField, Typography } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { parseResourceUri } from "../../utils/formatting";

export interface DashboardSourceEditorProps {
   resourceUri: string;
   dashboard: string;
   onSaved?: (source: string) => void;
   onCancel?: () => void;
}

function dashboardApi(
   environmentName: string,
   packageName: string,
   dashboard: string,
   suffix = "",
): string {
   return `/api/v0/environments/${environmentName}/packages/${packageName}/dashboards/${dashboard}${suffix}`;
}

function modelCompileApi(
   environmentName: string,
   packageName: string,
   dashboard: string,
): string {
   return `/api/v0/environments/${environmentName}/packages/${packageName}/models/dashboards/${dashboard}.malloy/compile`;
}

/**
 * Load / compile-as-file / save for `dashboards/{name}.malloy`.
 * Uses REST directly so we do not wait on OpenAPI client regen.
 */
export function DashboardSourceEditor({
   resourceUri,
   dashboard,
   onSaved,
   onCancel,
}: DashboardSourceEditorProps) {
   const { environmentName, packageName } = parseResourceUri(resourceUri);
   const [source, setSource] = useState("");
   const [status, setStatus] = useState<"loading" | "ready" | "error">(
      "loading",
   );
   const [busy, setBusy] = useState<"compile" | "save" | null>(null);
   const [message, setMessage] = useState<{
      severity: "success" | "error" | "info";
      text: string;
   } | null>(null);

   useEffect(() => {
      let cancelled = false;
      setStatus("loading");
      setMessage(null);
      fetch(dashboardApi(environmentName, packageName, dashboard, "/source"))
         .then(async (res) => {
            if (!res.ok) {
               throw new Error(await res.text());
            }
            return res.json() as Promise<{ source: string }>;
         })
         .then((body) => {
            if (!cancelled) {
               setSource(body.source);
               setStatus("ready");
            }
         })
         .catch((err) => {
            if (!cancelled) {
               setStatus("error");
               setMessage({
                  severity: "error",
                  text: `Could not load source: ${String(err)}`,
               });
            }
         });
      return () => {
         cancelled = true;
      };
   }, [environmentName, packageName, dashboard]);

   const compile = useCallback(async () => {
      setBusy("compile");
      setMessage(null);
      try {
         const res = await fetch(
            modelCompileApi(environmentName, packageName, dashboard),
            {
               method: "POST",
               headers: { "Content-Type": "application/json" },
               body: JSON.stringify({ source, scope: "file" }),
            },
         );
         const body = (await res.json()) as {
            status?: string;
            problems?: { severity?: string; message?: string }[];
         };
         const errors = (body.problems ?? []).filter(
            (p) => p.severity === "error",
         );
         if (body.status === "error" || errors.length > 0) {
            setMessage({
               severity: "error",
               text:
                  errors.map((p) => p.message).join("\n") ||
                  "Compile failed",
            });
         } else {
            setMessage({ severity: "success", text: "Compiles cleanly." });
         }
      } catch (err) {
         setMessage({
            severity: "error",
            text: `Compile request failed: ${String(err)}`,
         });
      } finally {
         setBusy(null);
      }
   }, [dashboard, environmentName, packageName, source]);

   const save = useCallback(async () => {
      setBusy("save");
      setMessage(null);
      try {
         const res = await fetch(
            dashboardApi(environmentName, packageName, dashboard, "/source"),
            {
               method: "PUT",
               headers: { "Content-Type": "application/json" },
               body: JSON.stringify({ source }),
            },
         );
         const body = (await res.json()) as {
            source?: string;
            message?: string;
         };
         if (!res.ok) {
            setMessage({
               severity: "error",
               text: body.message || "Save failed",
            });
            return;
         }
         setMessage({ severity: "success", text: "Saved and reloaded." });
         onSaved?.(body.source ?? source);
      } catch (err) {
         setMessage({
            severity: "error",
            text: `Save failed: ${String(err)}`,
         });
      } finally {
         setBusy(null);
      }
   }, [dashboard, environmentName, packageName, onSaved, source]);

   return (
      <Stack spacing={2}>
         <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Edit Malloy — {dashboard}
         </Typography>
         {message && (
            <Alert severity={message.severity} sx={{ whiteSpace: "pre-wrap" }}>
               {message.text}
            </Alert>
         )}
         <TextField
            value={source}
            onChange={(e) => setSource(e.target.value)}
            disabled={status !== "ready"}
            multiline
            minRows={16}
            fullWidth
            spellCheck={false}
            slotProps={{
               input: {
                  sx: {
                     fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                     fontSize: 13,
                     lineHeight: 1.45,
                  },
               },
            }}
         />
         <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
            {onCancel && (
               <Button onClick={onCancel} disabled={busy !== null}>
                  Cancel
               </Button>
            )}
            <Button
               onClick={() => void compile()}
               disabled={status !== "ready" || busy !== null}
            >
               {busy === "compile" ? "Checking…" : "Check compile"}
            </Button>
            <Button
               variant="contained"
               onClick={() => void save()}
               disabled={status !== "ready" || busy !== null}
            >
               {busy === "save" ? "Saving…" : "Save"}
            </Button>
         </Box>
      </Stack>
   );
}
