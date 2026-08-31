import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { AccessDeniedError, BadRequestError } from "../errors";
import { Environment } from "./environment";

const MODEL = `
source: orders is duckdb.sql("""
  SELECT 1 as id, 'Acme' as brand, 10.0 as amount
""") extend {
  measure: order_count is count()
  measure: total_amount is sum(amount)
}
`;

const OVERVIEW = `##! experimental.givens
import { orders } from '../orders.malloy'
# artifact { title="Overview" } dashboard { columns=12 }
query: overview is orders -> {
  aggregate: order_count
}
`;

const NEW_DASHBOARD = `##! experimental.givens
import { orders } from '../orders.malloy'
# artifact { title="Authored" } dashboard { columns=12 }
query: authored is orders -> {
  aggregate: total_amount
}
`;

describe("dashboard source write / compile-as-file", () => {
   let rootDir: string;
   let envPath: string;
   let env: Environment;

   async function writePkg(): Promise<void> {
      const pkg = path.join(envPath, "pkg");
      await fs.mkdir(path.join(pkg, "dashboards"), { recursive: true });
      await fs.writeFile(
         path.join(pkg, "publisher.json"),
         JSON.stringify({ name: "pkg", description: "dashboard write fixture" }),
      );
      await fs.writeFile(path.join(pkg, "orders.malloy"), MODEL);
      await fs.writeFile(path.join(pkg, "dashboards", "overview.malloy"), OVERVIEW);
   }

   beforeEach(async () => {
      rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "publisher-dash-src-"));
      envPath = path.join(rootDir, "env");
      await fs.mkdir(envPath, { recursive: true });
      await writePkg();
      env = await Environment.create("testEnv", envPath, []);
      await env.addPackage("pkg");
   });

   afterEach(async () => {
      await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
   });

   it("reads the dashboard file from disk", async () => {
      const { source } = await env.getDashboardSource("pkg", "overview");
      expect(source).toContain("# artifact { title=\"Overview\" }");
      expect(source).toContain("query: overview is orders");
   });

   it("compiling with replace treats source as the whole file", async () => {
      const replacement = `
source: orders is duckdb.sql("SELECT 2 as id, 'Beta' as brand, 5.0 as amount")
`;
      const appended = await env.compileSource(
         "pkg",
         "orders.malloy",
         'source: orders is duckdb.sql("SELECT 2 as id")',
      );
      expect(appended.problems.some((p) => p.severity === "error")).toBe(true);

      const replaced = await env.compileSource(
         "pkg",
         "orders.malloy",
         replacement,
         false,
         undefined,
         { replace: true },
      );
      expect(replaced.problems.filter((p) => p.severity === "error")).toEqual([]);
   });

   it("writes a new dashboard and lists it after reload", async () => {
      const { problems } = await env.writeDashboardSource(
         "pkg",
         "authored",
         NEW_DASHBOARD,
      );
      expect(problems.filter((p) => p.severity === "error")).toEqual([]);

      const onDisk = await fs.readFile(
         path.join(envPath, "pkg", "dashboards", "authored.malloy"),
         "utf8",
      );
      expect(onDisk).toBe(NEW_DASHBOARD);

      const pkg = await env.getPackage("pkg", false);
      const names = pkg.listDashboards().map((d) => d.name);
      expect(names).toContain("authored");
      expect(names).toContain("overview");
   });

   it("does not write when the source fails to compile", async () => {
      const before = await fs.readFile(
         path.join(envPath, "pkg", "dashboards", "overview.malloy"),
         "utf8",
      );
      await expect(
         env.writeDashboardSource(
            "pkg",
            "overview",
            "this is not malloy",
         ),
      ).rejects.toBeInstanceOf(BadRequestError);

      const after = await fs.readFile(
         path.join(envPath, "pkg", "dashboards", "overview.malloy"),
         "utf8",
      );
      expect(after).toBe(before);
      expect(
         await fs
            .access(path.join(envPath, "pkg", "dashboards", "broken.malloy"))
            .then(() => true)
            .catch(() => false),
      ).toBe(false);
   });

   it("rejects a write when the package location is remote", async () => {
      const pkg = await env.getPackage("pkg", false);
      pkg.setPackageMetadata({
         ...pkg.getPackageMetadata(),
         location: "https://github.com/malloydata/publisher",
      });
      await expect(
         env.writeDashboardSource("pkg", "overview", OVERVIEW),
      ).rejects.toBeInstanceOf(AccessDeniedError);
   });
});
