import chokidar, { FSWatcher } from "chokidar";
import { EventEmitter } from "events";
import { RequestHandler } from "express";
import path from "path";
import { components } from "../api";
import { logger } from "../logger";
import { EnvironmentStore } from "../service/environment_store";

type StartWatchReq = components["schemas"]["StartWatchRequest"];
type WatchStatusRes = components["schemas"]["WatchStatus"];
type Handler<Req = object, Res = void> = RequestHandler<object, Res, Req>;

// File extensions that should trigger a live-reload event but NOT a Malloy
// environment reload (these are package assets, not semantic-model sources).
const ASSET_EXTS = new Set([
   ".html",
   ".htm",
   ".css",
   ".js",
   ".mjs",
   ".json",
   ".png",
   ".jpg",
   ".jpeg",
   ".gif",
   ".svg",
   ".webp",
   ".ico",
   ".woff",
   ".woff2",
]);
const MODEL_EXTS = new Set([".malloy", ".malloynb", ".md"]);

export class WatchModeController {
   watchingPath: string | null;
   watchingEnvironmentName: string | null;
   watcher: FSWatcher;
   /**
    * Per-package change bus. Event name is `<environmentName>/<packageName>`.
    * Used by the SSE live-reload endpoint to push refreshes to embedded HTML
    * dashboards. Each emit carries `{ path, kind }` for diagnostics; the SSE
    * handler currently ignores the payload and just sends "changed".
    */
   public events = new EventEmitter();

   constructor(private environmentStore: EnvironmentStore) {
      this.watchingPath = null;
      this.watchingEnvironmentName = null;
      // Live-reload subscribers can be many (one per open browser tab);
      // bump the default cap so Node doesn't warn under normal use.
      this.events.setMaxListeners(100);
   }

   /** Idempotent: starts watching `environmentName` if not already. */
   public async ensureWatching(environmentName: string): Promise<void> {
      if (this.watchingEnvironmentName === environmentName && this.watcher) {
         return;
      }
      if (this.watcher) {
         await this.watcher.close();
      }
      // Resolve the actual on-disk path for this environment. Publisher
      // mounts/copies package directories to a per-environment location that
      // is NOT necessarily `<serverRoot>/<envName>`, so we ask the env itself.
      let watchPath: string;
      try {
         const env = await this.environmentStore.getEnvironment(
            environmentName,
            false,
         );
         watchPath = env.getEnvironmentPath();
      } catch (error) {
         logger.warn(
            "Watch mode: falling back to <serverRoot>/<env> path because " +
               "environment lookup failed",
            { error, environmentName },
         );
         watchPath = path.join(
            this.environmentStore.serverRootPath,
            environmentName,
         );
      }
      this.startWatcher(environmentName, watchPath);
   }

   private startWatcher(watchName: string, watchPath: string) {
      this.watchingEnvironmentName = watchName;
      this.watchingPath = watchPath;
      this.watcher = chokidar.watch(this.watchingPath, {
         ignored: (filePath, stats) => {
            if (!stats?.isFile()) return false;
            const ext = path.extname(filePath).toLowerCase();
            return !MODEL_EXTS.has(ext) && !ASSET_EXTS.has(ext);
         },
         ignoreInitial: true,
      });
      const reloadEnvironment = async () => {
         const environment = await this.environmentStore.getEnvironment(
            watchName,
            true,
         );
         await this.environmentStore.addEnvironment(environment.metadata);
         logger.info(`Reloaded environment ${watchName}`);
      };
      const onEvent =
         (kind: "add" | "change" | "unlink") => async (filePath: string) => {
            logger.info(`Watch ${kind}: ${filePath}; environment=${watchName}`);
            const ext = path.extname(filePath).toLowerCase();
            // Only reload Malloy state for model-relevant files. Asset edits
            // (HTML/CSS/JS) just need the live-reload fanout below.
            if (MODEL_EXTS.has(ext)) {
               await reloadEnvironment();
            }
            // Compute the package key from the path so the SSE endpoint can
            // fan out only to clients embedded in the affected package.
            const rel = path.relative(this.watchingPath ?? "", filePath);
            const firstSegment = rel.split(path.sep)[0];
            if (firstSegment && !firstSegment.startsWith("..")) {
               this.events.emit(`${watchName}/${firstSegment}`, {
                  path: filePath,
                  kind,
               });
            }
         };
      this.watcher.on("add", onEvent("add"));
      this.watcher.on("change", onEvent("change"));
      this.watcher.on("unlink", onEvent("unlink"));
   }

   public getWatchStatus: Handler<void, WatchStatusRes> = async (_req, res) => {
      return res.json({
         enabled: !!this.watchingPath,
         watchingPath: this.watchingPath ?? "",
         environmentName: this.watchingEnvironmentName ?? "",
      });
   };

   public startWatching: Handler<StartWatchReq, { error: string }> = async (
      req,
      res,
   ) => {
      const watchName = req.body.environmentName ?? "";
      const environmentManifest =
         await EnvironmentStore.reloadEnvironmentManifest(
            this.environmentStore.serverRootPath,
         );
      const environment = environmentManifest.environments.find(
         (e) => e.name === watchName,
      );
      if (
         !environment ||
         !environment.packages ||
         environment.packages.length === 0
      ) {
         res.status(404).json({
            error: `Environment ${watchName} not found or has no packages`,
         });
         return;
      }
      await this.ensureWatching(watchName);
      res.json();
   };

   public stopWatchMode: Handler = async (_req, res) => {
      if (this.watcher) {
         await this.watcher.close();
      }
      this.watchingPath = null;
      this.watchingEnvironmentName = null;
      res.json();
   };
}
