/**
 * Wrap Explorer `ASTQuery.toMalloy()` as a self-contained `# artifact`
 * dashboard file. When the query already has `# dashboard` / `# colspan`
 * (malloy-explorer viz picker, later), those tags are left alone.
 */

export interface ArtifactFromExplorerInput {
   malloy: string;
   sourceName: string;
   modelPath: string;
   title: string;
   slug: string;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function slugifyDashboardName(value: string): string {
   const slug = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
   return slug.length > 0 ? slug : "dashboard";
}

export function sourceNameFromMalloy(malloy: string): string | undefined {
   const match = malloy
      .trim()
      .match(/^(?:run:\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*->/);
   return match?.[1];
}

export function importPathFromModel(modelPath: string): string {
   const normalized = modelPath.replace(/\\/g, "/").replace(/^\.\//, "");
   return `../${normalized}`;
}

export function hasDashboardGridTags(malloy: string): boolean {
   return /#\s*dashboard\b/.test(malloy) || /#\s*colspan\b/.test(malloy);
}

export function artifactFromExplorer(
   input: ArtifactFromExplorerInput,
): string {
   if (!IDENT.test(input.slug)) {
      throw new Error(
         `Invalid dashboard slug "${input.slug}": use letters, digits, and underscore`,
      );
   }
   if (!IDENT.test(input.sourceName)) {
      throw new Error(`Invalid source name "${input.sourceName}"`);
   }

   const viewBody = extractViewBody(input.malloy, input.sourceName);
   const keepGrid = hasDashboardGridTags(input.malloy);
   const taggedBody = keepGrid ? viewBody : applyHeuristicColspans(viewBody);
   const dashboardTag = keepGrid ? existingDashboardTag(input.malloy) : {
      columns: 12,
   };
   const columnsPart =
      dashboardTag.columns !== undefined
         ? ` dashboard { columns=${dashboardTag.columns} }`
         : "";
   const title = escapeMalloyDoubleQuoted(input.title || input.slug);
   const importPath = importPathFromModel(input.modelPath);

   return [
      "##! experimental.givens",
      `import { ${input.sourceName} } from '${importPath}'`,
      `# artifact { title="${title}" }${columnsPart}`,
      `query: ${input.slug} is ${input.sourceName} -> {`,
      indentBlock(taggedBody),
      "}",
      "",
   ].join("\n");
}

function existingDashboardTag(malloy: string): { columns?: number } {
   const match = malloy.match(/#\s*dashboard\s*\{[^}]*columns\s*=\s*(\d+)/);
   if (match) {
      return { columns: Number(match[1]) };
   }
   if (/#\s*dashboard\b/.test(malloy)) {
      return {};
   }
   return { columns: 12 };
}

function extractViewBody(malloy: string, sourceName: string): string {
   const trimmed = malloy.trim();
   const escaped = sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
   const patterns = [
      new RegExp(
         `^(?:run:\\s*)?${escaped}\\s*->\\s*\\{([\\s\\S]*)\\}\\s*$`,
      ),
      /^(?:run:\s*)?[A-Za-z_][A-Za-z0-9_]*\s*->\s*\{([\s\S]*)\}\s*$/,
      /query:\s+[A-Za-z_][A-Za-z0-9_]*\s+is\s+[A-Za-z_][A-Za-z0-9_]*\s*->\s*\{([\s\S]*)\}\s*$/,
   ];
   for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match) {
         return trimOuterNewlines(match[1]);
      }
   }
   return trimmed;
}

/**
 * First-cut grid when the viz picker has not written tags: KPI-style
 * aggregates share a row; the first nest starts a new row at half width.
 */
export function applyHeuristicColspans(body: string): string {
   if (/#\s*colspan\b/.test(body) || /#\s*break\b/.test(body)) {
      return body;
   }

   const lines = body.split("\n");
   let depth = 0;
   let inAggregate = false;
   const aggregateLines: number[] = [];
   const nestLines: number[] = [];

   for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (depth === 0) {
         const aggregateInline = line.match(/^\s*aggregate:\s+(\S.*)$/);
         if (aggregateInline) {
            const names = aggregateInline[1]
               .split(",")
               .map((part) => part.trim())
               .filter((part) => IDENT.test(part));
            if (names.length === 1 && IDENT.test(names[0])) {
               aggregateLines.push(i);
            }
            inAggregate = !line.includes("{");
         } else if (/^\s*aggregate:\s*$/.test(line)) {
            inAggregate = true;
         } else if (/^\s*nest:/.test(line)) {
            nestLines.push(i);
            inAggregate = false;
         } else if (inAggregate) {
            if (
               /^\s*(group_by|calculate|where|having|order_by|limit|nest|declare|extend):/.test(
                  line,
               )
            ) {
               inAggregate = false;
            } else if (/^\s*[A-Za-z_][A-Za-z0-9_]*\s*$/.test(line)) {
               aggregateLines.push(i);
            }
         }
      }
      depth += (line.match(/\{/g) ?? []).length;
      depth -= (line.match(/\}/g) ?? []).length;
   }

   const n = aggregateLines.length;
   const colspan = n > 0 && n <= 4 ? Math.floor(12 / n) : 3;
   const insertions = new Map<number, string[]>();

   for (const line of aggregateLines) {
      insertions.set(line, [`# colspan=${colspan}`]);
   }
   nestLines.forEach((line, index) => {
      const tags = index === 0 ? ["# break", "# colspan=6"] : ["# colspan=6"];
      insertions.set(line, tags);
   });

   if (insertions.size === 0) {
      return body;
   }

   const out: string[] = [];
   for (let i = 0; i < lines.length; i++) {
      const tags = insertions.get(i);
      if (tags) {
         const indent = lines[i].match(/^\s*/)?.[0] ?? "";
         for (const tag of tags) {
            out.push(`${indent}${tag}`);
         }
      }
      out.push(lines[i]);
   }
   return out.join("\n");
}

function indentBlock(body: string): string {
   if (body.length === 0) return "  ";
   return body
      .split("\n")
      .map((line) => (line.length === 0 ? line : `  ${line}`))
      .join("\n");
}

function trimOuterNewlines(text: string): string {
   return text.replace(/^\n/, "").replace(/\n$/, "");
}

function escapeMalloyDoubleQuoted(value: string): string {
   return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
