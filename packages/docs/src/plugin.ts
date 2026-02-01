import { type Plugin, tool } from "@opencode-ai/plugin";
import { TemplateResolver } from "./templates";
import { PresetManager } from "./presets";
import { pandoc, computeOutputPath } from "./builder";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";

// YAML string escaping helper
function escapeYaml(str: string): string {
  return str.replace(/"/g, '\\"').replace(/\n/g, ' ');
}

// Human-readable ID generation (Claude-style: purple-squirrel-482)
const ADJECTIVES = [
  "amber", "ancient", "autumn", "bold", "brave", "bright", "calm", "clever", "cool", "crimson",
  "curious", "daring", "deep", "eager", "elegant", "fierce", "gentle", "golden", "graceful", "happy",
  "hidden", "jade", "joyful", "kind", "lively", "lucky", "mighty", "misty", "modern", "mystic",
  "noble", "peaceful", "purple", "quiet", "rapid", "royal", "rustic", "serene", "silent", "silver",
  "smooth", "solid", "spring", "steady", "summer", "swift", "tender", "vivid", "warm", "wild",
  "wise", "young", "zealous", "azure", "blazing", "breezy", "cosmic", "crystal", "dawn", "dusk"
];

const NOUNS = [
  "apple", "arrow", "autumn", "beach", "bird", "bloom", "breeze", "brook", "canyon", "cloud",
  "coral", "crane", "crystal", "dolphin", "dream", "eagle", "field", "flame", "flower", "forest",
  "fountain", "garden", "gate", "glade", "grove", "harbor", "haven", "hill", "horizon", "island",
  "journey", "lake", "leaf", "meadow", "mirror", "mist", "moon", "mountain", "night", "ocean",
  "orchard", "peak", "pine", "pond", "rain", "ravine", "river", "road", "rock", "rose",
  "sands", "sea", "shade", "sky", "spring", "star", "stone", "stream", "sun", "sunset",
  "surf", "swan", "tide", "tower", "tree", "valley", "wave", "willow", "wind", "wood"
];

function generateDocId(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 900) + 100; // 3-digit number
  return `${adj}-${noun}-${num}`;
}

// Get the docs directory path (project-local .opencode/docs)
function getDocsBasePath(ctx: { worktree?: string; directory: string }): string {
  const base = ctx.worktree || ctx.directory || process.cwd();
  if (!base || base === "/") {
    throw new Error("Cannot determine project directory. Please run from a project directory.");
  }
  return join(base, ".opencode", "docs");
}

function getRegistryPath(ctx: { worktree?: string; directory: string }): string {
  const base = ctx.worktree || ctx.directory || process.cwd();
  if (!base || base === "/") {
    throw new Error("Cannot determine project directory. Please run from a project directory.");
  }
  return join(base, ".opencode", "docs-registry.json");
}

// Ensure directories exist
function ensureDocsDir(ctx: { worktree?: string; directory: string }): void {
  const basePath = getDocsBasePath(ctx);
  if (!existsSync(basePath)) {
    mkdirSync(basePath, { recursive: true });
  }
}

// Read/write registry
interface DocRegistry {
  drafts: Record<string, {
    title: string;
    preset: string;
    created_at: string;
    last_modified: string;
    source_markdown?: string;
    status: "draft" | "compiled";
  }>;
}

function readRegistry(ctx: { worktree?: string; directory: string }): DocRegistry {
  const path = getRegistryPath(ctx);
  if (!existsSync(path)) {
    return { drafts: {} };
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return { drafts: {} };
  }
}

function writeRegistry(ctx: { worktree?: string; directory: string }, registry: DocRegistry): void {
  const path = getRegistryPath(ctx);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(registry, null, 2));
}

// Generate unique doc ID
function generateUniqueDocId(ctx: { worktree?: string; directory: string }): string {
  const registry = readRegistry(ctx);
  let id: string;
  let attempts = 0;
  do {
    id = generateDocId();
    attempts++;
  } while (registry.drafts[id] && attempts < 100);
  
  if (attempts >= 100) {
    // Fallback: append timestamp
    id = `${generateDocId()}-${Date.now()}`;
  }
  return id;
}

// Validate doc_id format to prevent path traversal
function isValidDocId(docId: string): boolean {
  return /^[a-z]+-[a-z]+-\d+(-\d+)?$/.test(docId);
}

export const DocsPlugin: Plugin = async (ctx) => {
  const resolver = new TemplateResolver({ projectRoot: ctx.worktree || ctx.directory });
  const presetManager = new PresetManager(resolver);

  return {
    tool: {
      docs_draft: tool({
        description: "Create a document draft with a unique ID for iterative editing. Generates a project-local intermediate that can be edited and compiled multiple times.",
        args: {
          title: tool.schema.string().describe("Document title"),
          preset: tool.schema.string().describe("Preset name (use docs_presets_list to see options)"),
          initial_content: tool.schema.string().optional().describe("Initial markdown content. If not provided, creates an empty draft."),
          source_markdown: tool.schema.string().optional().describe("Path to existing markdown file to use as initial content"),
        },
        async execute(args) {
          ensureDocsDir(ctx);
          
          const docId = generateUniqueDocId(ctx);
          const draftDir = join(getDocsBasePath(ctx), docId);
          mkdirSync(draftDir, { recursive: true });
          
          // Get initial content
          let content = "";
          if (args.initial_content) {
            content = args.initial_content;
          } else if (args.source_markdown && existsSync(args.source_markdown)) {
            content = readFileSync(args.source_markdown, "utf-8");
          }
          
          // Add YAML frontmatter if not present
          if (!content.startsWith("---")) {
            const frontmatter = [
              "---",
              `title: "${escapeYaml(args.title)}"`,
              `date: "${new Date().toISOString().split("T")[0]}"`,
              "---",
              "",
            ].join("\n");
            content = frontmatter + content;
          }
          
          // Write draft markdown
          const draftPath = join(draftDir, "draft.md");
          writeFileSync(draftPath, content);
          
          // Write metadata
          const metaPath = join(draftDir, "meta.json");
          const meta = {
            title: args.title,
            preset: args.preset,
            created_at: new Date().toISOString(),
            last_modified: new Date().toISOString(),
            source_markdown: args.source_markdown,
            status: "draft",
          };
          writeFileSync(metaPath, JSON.stringify(meta, null, 2));
          
          // Update registry
          const registry = readRegistry(ctx);
          registry.drafts[docId] = {
            title: args.title,
            preset: args.preset,
            created_at: meta.created_at,
            last_modified: meta.last_modified,
            source_markdown: args.source_markdown,
            status: "draft",
          };
          writeRegistry(ctx, registry);
          
          return [
            `Draft created: ${args.title}`,
            ``,
            `Document ID: ${docId}`,
            `Draft path: ${draftPath}`,
            `Preset: ${args.preset}`,
            ``,
            `Next steps:`,
            `1. Edit the draft: ${draftPath}`,
            `2. Compile when ready: docs_compile doc_id="${docId}"`,
          ].join("\n");
        },
      }),

      docs_list_drafts: tool({
        description: "List all active document drafts in the current project.",
        args: {},
        async execute() {
          const registry = readRegistry(ctx);
          const drafts = Object.entries(registry.drafts);
          
          if (drafts.length === 0) {
            return "No active drafts. Create one with docs_draft.";
          }
          
          const lines = ["Active document drafts:", ""];
          for (const [id, info] of drafts) {
            const draftPath = join(getDocsBasePath(ctx), id, "draft.md");
            const exists = existsSync(draftPath);
            const status = exists ? info.status : "missing";
            lines.push(`${id}`);
            lines.push(`  Title: ${info.title}`);
            lines.push(`  Preset: ${info.preset}`);
            lines.push(`  Status: ${status}`);
            lines.push(`  Modified: ${info.last_modified.split("T")[0]}`);
            lines.push(`  Path: ${draftPath}`);
            lines.push("");
          }
          return lines.join("\n");
        },
      }),

      docs_compile: tool({
        description: "Compile a drafted document to PDF. Uses the preset and metadata from when the draft was created.",
        args: {
          doc_id: tool.schema.string().describe("Document ID (e.g., 'purple-squirrel-482')"),
          output_path: tool.schema.string().optional().describe("Custom output path for PDF. If omitted, saves next to draft."),
          // Allow overriding specific metadata at compile time
          author: tool.schema.string().optional(),
          date: tool.schema.string().optional(),
          subtitle: tool.schema.string().optional(),
          abstract: tool.schema.string().optional(),
          keywords: tool.schema.string().optional(),
          bibliography: tool.schema.string().optional().describe("Path to .bib file"),
          // School report specific
          logo: tool.schema.string().optional().describe("Logo option (sit, uofg, both) - for school-report preset"),
          course: tool.schema.string().optional(),
          project_title: tool.schema.string().optional(),
          group: tool.schema.string().optional(),
          authors: tool.schema.string().optional().describe("JSON array for authors table: [{name, sit_id, glasgow_id}, ...]"),
          version: tool.schema.string().optional(),
          project_topic_id: tool.schema.string().optional(),
        },
        async execute(args) {
          if (!isValidDocId(args.doc_id)) {
            return `Invalid document ID format: ${args.doc_id}`;
          }
          
          const registry = readRegistry(ctx);
          const draftInfo = registry.drafts[args.doc_id];
          
          if (!draftInfo) {
            return `Draft not found: ${args.doc_id}. Use docs_list_drafts to see available drafts.`;
          }
          
          const draftDir = join(getDocsBasePath(ctx), args.doc_id);
          const draftPath = join(draftDir, "draft.md");
          
          if (!existsSync(draftPath)) {
            return `Draft file missing: ${draftPath}`;
          }
          
          // Update last modified
          draftInfo.last_modified = new Date().toISOString();
          draftInfo.status = "compiled";
          writeRegistry(ctx, registry);
          
          // Determine output path
          const outputPath = args.output_path || join(draftDir, `${args.doc_id}.pdf`);
          
          // Load preset
          const preset = await presetManager.loadPreset(draftInfo.preset, args.logo);
          
          // Build pandoc command
          const builder = pandoc().input(draftPath).output(outputPath);
          
          // Apply preset
          if (preset.template?.path && !preset.resolved_template_path) {
            throw new Error(`Template '${preset.template.path}' not found. Use docs_templates_install.`);
          }
          
          builder.applyPreset(preset).listings();
          
          // Apply metadata overrides
          const metadata: Record<string, string> = {};
          if (args.author) metadata.author = args.author;
          if (args.date) metadata.date = args.date;
          if (args.subtitle) metadata.subtitle = args.subtitle;
          if (args.abstract) metadata.abstract = args.abstract;
          if (args.keywords) metadata.keywords = args.keywords;
          if (Object.keys(metadata).length > 0) {
            builder.applyMetadata(metadata);
          }
          
          // Bibliography
          if (args.bibliography) builder.bibliography(args.bibliography);
          
          // School report specific variables
          if (args.logo) {
            const assetsDir = resolver.getUserConfigDir() + "/assets";
            if (args.logo === "sit") {
              builder.variable("logo-mode", "single").variable("sit-logo", `${assetsDir}/sit-logo.png`);
            } else if (args.logo === "uofg") {
              builder.variable("logo-mode", "single").variable("uofg-logo", `${assetsDir}/uofg-logo.png`);
            } else if (args.logo === "both") {
              builder.variable("logo-mode", "both")
                .variable("sit-logo", `${assetsDir}/sit-logo.png`)
                .variable("uofg-logo", `${assetsDir}/uofg-logo.png`);
            }
          }
          if (args.course) builder.variable("course", args.course);
          if (args.project_title) builder.variable("project-title", args.project_title);
          if (args.group) builder.variable("group", args.group);
          if (args.version) builder.variable("version", args.version);
          if (args.project_topic_id) builder.variable("project-topic-id", args.project_topic_id);
          
          // Handle authors table
          let metaFileToCleanup: string | null = null;
          if (args.authors) {
            try {
              const authorsArray = JSON.parse(args.authors) as Array<{ name: string; sit_id: string; glasgow_id: string }>;
              const yamlLines = ["authors:"];
              for (const author of authorsArray) {
                yamlLines.push(`  - name: "${escapeYaml(author.name)}"`);
                if (author.sit_id) {
                  yamlLines.push(`    sit-id: "${escapeYaml(author.sit_id)}"`);
                }
                if (author.glasgow_id) {
                  yamlLines.push(`    glasgow-id: "${escapeYaml(author.glasgow_id)}"`);
                }
              }
              metaFileToCleanup = join(draftDir, `authors-${Date.now()}.yaml`);
              writeFileSync(metaFileToCleanup, yamlLines.join("\n"));
              builder.metadataFile(metaFileToCleanup);
            } catch (e) {
              throw new Error(`Invalid authors JSON: ${e}`);
            }
          }
          
          // Execute
          const result = await builder.execute();
          
          // Cleanup
          if (metaFileToCleanup && existsSync(metaFileToCleanup)) {
            try { await Bun.spawn(["rm", "-f", metaFileToCleanup]).exited; } catch {}
          }
          
          if (!result.success) {
            throw new Error(`Compilation failed:\n${result.error}`);
          }
          
          return `Compiled: ${outputPath}\nDocument: ${draftInfo.title}\nPreset: ${draftInfo.preset}`;
        },
      }),

      docs_delete_draft: tool({
        description: "Delete a draft and its associated files.",
        args: {
          doc_id: tool.schema.string().describe("Document ID to delete"),
        },
        async execute(args) {
          if (!isValidDocId(args.doc_id)) {
            return `Invalid document ID format: ${args.doc_id}`;
          }
          
          const registry = readRegistry(ctx);
          
          if (!registry.drafts[args.doc_id]) {
            return `Draft not found: ${args.doc_id}`;
          }
          
          const draftDir = join(getDocsBasePath(ctx), args.doc_id);
          
          // Remove directory
          if (existsSync(draftDir)) {
            await Bun.spawn(["rm", "-rf", draftDir]).exited;
          }
          
          // Remove from registry
          delete registry.drafts[args.doc_id];
          writeRegistry(ctx, registry);
          
          return `Deleted draft: ${args.doc_id}`;
        },
      }),

      // Legacy tools (kept for compatibility)
      docs_convert: tool({
        description: "Convert documents between formats using pandoc.",
        args: {
          input_path: tool.schema.string().describe("Absolute path to the input file"),
          output_format: tool.schema.enum(["pdf", "docx", "odt", "markdown", "html", "latex"]).describe("Target format"),
          from_format: tool.schema.string().optional().describe("Source format (auto-detected if omitted)"),
          output_dir: tool.schema.string().optional().describe("Directory to save output"),
        },
        async execute(args) {
          const outputPath = computeOutputPath(args.input_path, args.output_dir, args.output_format);
          const builder = pandoc().input(args.input_path).output(outputPath);
          if (args.from_format) builder.from(args.from_format);
          const result = await builder.execute();
          if (!result.success) throw new Error(`Pandoc failed:\n${result.error}`);
          return `Converted ${args.input_path} to ${outputPath}`;
        },
      }),

      docs_compile_latex: tool({
        description: "Compile LaTeX files to PDF using pdflatex.",
        args: {
          file_path: tool.schema.string().describe("Absolute path to the .tex file"),
          output_dir: tool.schema.string().optional().describe("Directory to save the output PDF"),
        },
        async execute(args) {
          if (!args.file_path.endsWith(".tex")) throw new Error("Input file must be a .tex file");
          const inputDir = args.file_path.split("/").slice(0, -1).join("/");
          const outputDir = args.output_dir || inputDir;
          const proc = Bun.spawn(["pdflatex", "-output-directory", outputDir, "-interaction=nonstopmode", args.file_path], { stdout: "pipe", stderr: "pipe" });
          await proc.exited;
          if (proc.exitCode !== 0) {
            const stderr = await new Response(proc.stderr).text();
            throw new Error(`Compilation failed:\n${stderr}`);
          }
          return `Compiled ${args.file_path} to PDF.`;
        },
      }),

      docs_presets_list: tool({
        description: "List all available document presets.",
        args: {},
        async execute() {
          const presets = presetManager.listPresets();
          if (presets.length === 0) return "No presets available.";
          const bySource: Record<string, typeof presets> = { builtin: [], user: [], project: [] };
          for (const p of presets) bySource[p.source].push(p);
          const lines = ["Available presets:\n"];
          if (bySource.builtin.length > 0) {
            lines.push("Built-in:");
            for (const p of bySource.builtin) lines.push(`  - ${p.name}${p.description ? `: ${p.description}` : ""}`);
            lines.push("");
          }
          if (bySource.user.length > 0) {
            lines.push("User:");
            for (const p of bySource.user) lines.push(`  - ${p.name}`);
          }
          if (bySource.project.length > 0) {
            lines.push("Project:");
            for (const p of bySource.project) lines.push(`  - ${p.name}`);
          }
          return lines.join("\n");
        },
      }),

      docs_presets_show: tool({
        description: "Show detailed configuration of a preset.",
        args: { preset_name: tool.schema.string().describe("Preset name") },
        async execute(args) {
          const info = await presetManager.getPresetInfo(args.preset_name);
          const lines = [`Preset: ${info.config.name}`];
          if (info.config.description) lines.push(`Description: ${info.config.description}`);
          lines.push(`Source: ${info.source}`);
          if (info.config.template) {
            lines.push(`Template: ${info.config.template.path} (${info.template_available ? "installed" : "not installed"})`);
          }
          if (info.available_logos?.length) lines.push(`Logos: ${info.available_logos.join(", ")}`);
          if (info.config.required_fields) lines.push(`Required: ${info.config.required_fields.join(", ")}`);
          return lines.join("\n");
        },
      }),

      docs_templates_list: tool({
        description: "List installed LaTeX templates and CSL styles.",
        args: {},
        async execute() {
          const templates = resolver.listTemplates();
          const csl = resolver.listCslStyles();
          const lines = ["Templates:"];
          if (templates.length === 0) lines.push("  (none - use docs_templates_install)");
          else for (const t of templates) lines.push(`  - ${t.name} (${t.source})`);
          lines.push("\nCSL Styles:");
          if (csl.length === 0) lines.push("  (none)");
          else for (const s of csl) lines.push(`  - ${s.name}`);
          return lines.join("\n");
        },
      }),

      docs_templates_install: tool({
        description: "Install template or CSL. Sources: eisvogel, ieee, csl-ieee, csl-apa, csl-acm",
        args: {
          source: tool.schema.enum(["eisvogel", "ieee", "csl-ieee", "csl-apa", "csl-acm"]).describe("Source"),
        },
        async execute(args) {
          await resolver.ensureUserConfigDirs();
          const userDir = resolver.getUserConfigDir();

          // Eisvogel requires special handling - download tarball and extract
          if (args.source === "eisvogel") {
            const tarUrl = "https://github.com/Wandmalfarbe/pandoc-latex-template/releases/download/v3.3.0/Eisvogel.tar.gz";
            const dest = `${userDir}/templates/eisvogel.latex`;
            const tmpDir = "/tmp/eisvogel-install";

            await Bun.spawn(["rm", "-rf", tmpDir]).exited;
            await Bun.spawn(["mkdir", "-p", tmpDir]).exited;

            // Download
            const dlProc = Bun.spawn(["curl", "-sL", "-o", `${tmpDir}/template.tar.gz`, tarUrl], { stdout: "pipe", stderr: "pipe" });
            await dlProc.exited;
            if (dlProc.exitCode !== 0) {
              const stderr = await new Response(dlProc.stderr).text();
              throw new Error(`Download failed: ${stderr}`);
            }

            // Extract
            const tarProc = Bun.spawn(["tar", "-xz", "-C", tmpDir, "-f", `${tmpDir}/template.tar.gz`], { stdout: "pipe", stderr: "pipe" });
            await tarProc.exited;
            if (tarProc.exitCode !== 0) {
              const stderr = await new Response(tarProc.stderr).text();
              throw new Error(`Extraction failed: ${stderr}`);
            }

            // Copy the template file
            await Bun.spawn(["cp", `${tmpDir}/eisvogel.latex`, dest]).exited;
            await Bun.spawn(["rm", "-rf", tmpDir]).exited;

            presetManager.clearCache();
            return `Installed eisvogel to ${dest}`;
          }

          // IEEE needs special handling - download template AND class file
          if (args.source === "ieee") {
            const ieeeDir = `${userDir}/templates/ieee`;
            await Bun.spawn(["mkdir", "-p", ieeeDir]).exited;

            // Download pandoc template
            const tplRes = await fetch("https://raw.githubusercontent.com/stsewd/ieee-pandoc-template/master/template.latex");
            if (!tplRes.ok) throw new Error(`Template download failed: HTTP ${tplRes.status}`);
            await Bun.write(`${ieeeDir}/template.latex`, await tplRes.text());

            // Download IEEEtran.cls from CTAN (required for compilation)
            const clsProc = Bun.spawn(["curl", "-sL", "-o", `${ieeeDir}/IEEEtran.cls`, "http://mirrors.ctan.org/macros/latex/contrib/IEEEtran/IEEEtran.cls"], { stdout: "pipe", stderr: "pipe" });
            await clsProc.exited;
            if (clsProc.exitCode !== 0) {
              throw new Error("Failed to download IEEEtran.cls from CTAN");
            }

            presetManager.clearCache();
            return `Installed IEEE template + IEEEtran.cls to ${ieeeDir}`;
          }

          // Other templates use direct URL download
          const urls: Record<string, { url: string; dest: string }> = {
            "csl-ieee": { url: "https://raw.githubusercontent.com/citation-style-language/styles/master/ieee.csl", dest: `${userDir}/csl/ieee.csl` },
            "csl-apa": { url: "https://raw.githubusercontent.com/citation-style-language/styles/master/apa.csl", dest: `${userDir}/csl/apa.csl` },
            "csl-acm": { url: "https://raw.githubusercontent.com/citation-style-language/styles/master/acm-sig-proceedings.csl", dest: `${userDir}/csl/acm-sig-proceedings.csl` },
          };
          const { url, dest } = urls[args.source];
          await Bun.spawn(["mkdir", "-p", dest.split("/").slice(0, -1).join("/")]).exited;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          await Bun.write(dest, await res.text());
          presetManager.clearCache();
          return `Installed ${args.source} to ${dest}`;
        },
      }),

      docs_create: tool({
        description: "Create document using a preset. Use docs_presets_list to see options.",
        args: {
          input_path: tool.schema.string().describe("Path to Markdown file"),
          preset: tool.schema.string().describe("Preset name"),
          output_dir: tool.schema.string().optional().describe("Output directory"),
          logo: tool.schema.string().optional().describe("Logo option (sit, uofg, both)"),
          title: tool.schema.string().optional(),
          author: tool.schema.string().optional(),
          date: tool.schema.string().optional(),
          subtitle: tool.schema.string().optional(),
          abstract: tool.schema.string().optional(),
          keywords: tool.schema.string().optional(),
          bibliography: tool.schema.string().optional().describe("Path to .bib file"),
        },
        async execute(args) {
          const preset = await presetManager.loadPreset(args.preset, args.logo);
          if (preset.template?.path && !preset.resolved_template_path) {
            throw new Error(`Template '${preset.template.path}' not found. Use docs_templates_install.`);
          }
          const outputPath = computeOutputPath(args.input_path, args.output_dir, "pdf");
          const builder = pandoc().input(args.input_path).output(outputPath).applyPreset(preset).listings()
            .applyMetadata({ title: args.title, author: args.author, date: args.date, subtitle: args.subtitle, abstract: args.abstract, keywords: args.keywords });
          if (args.bibliography) builder.bibliography(args.bibliography);
          // For IEEE templates, run from template directory so LaTeX can find IEEEtran.cls
          const isIeee = preset.name?.includes('ieee') || args.preset?.includes('ieee');
          let cwd: string | undefined;
          if (isIeee && preset.resolved_template_path) {
            cwd = preset.resolved_template_path.split("/").slice(0, -1).join("/");
            // Use simple tables for IEEE compatibility
            builder.simpleTables();
          }
          const result = await builder.execute(cwd);
          if (!result.success) throw new Error(`Failed:\n${result.error}`);
          return `Created: ${outputPath}\nPreset: ${preset.name}`;
        },
      }),

      docs_create_ieee_paper: tool({
        description: "Create IEEE paper (two-column).",
        args: {
          input_path: tool.schema.string().describe("Markdown file path"),
          format: tool.schema.enum(["conference", "journal"]).optional(),
          title: tool.schema.string(),
          author: tool.schema.string(),
          abstract: tool.schema.string(),
          keywords: tool.schema.string().optional(),
          bibliography: tool.schema.string().optional(),
          output_dir: tool.schema.string().optional(),
        },
        async execute(args) {
          const preset = await presetManager.loadPreset(args.format === "journal" ? "ieee-journal" : "ieee-conference");
          if (!preset.resolved_template_path) throw new Error("IEEE template not found. Run: docs_templates_install ieee");
          const outputPath = computeOutputPath(args.input_path, args.output_dir, "pdf");
          const builder = pandoc().input(args.input_path).output(outputPath).applyPreset(preset)
            .applyMetadata({ title: args.title, author: args.author, abstract: args.abstract, keywords: args.keywords });
          if (args.bibliography) builder.bibliography(args.bibliography);
          // Run from template directory so LaTeX can find IEEEtran.cls
          // Use simple tables for IEEE compatibility
          builder.simpleTables();
          const templateDir = preset.resolved_template_path.split("/").slice(0, -1).join("/");
          const result = await builder.execute(templateDir);
          if (!result.success) throw new Error(`Failed:\n${result.error}`);
          return `Created IEEE ${args.format || "conference"} paper: ${outputPath}`;
        },
      }),

      docs_generate_latex: tool({
        description: "Generate LaTeX source from markdown using a preset. Outputs .tex file instead of PDF for manual editing or custom compilation.",
        args: {
          input_path: tool.schema.string().describe("Path to Markdown file"),
          preset: tool.schema.string().describe("Preset name (use docs_presets_list to see options)"),
          output_path: tool.schema.string().optional().describe("Output path for .tex file (defaults to same name as input)"),
          logo: tool.schema.string().optional().describe("Logo option for school-report preset (sit, uofg, both)"),
          title: tool.schema.string().optional(),
          author: tool.schema.string().optional(),
          date: tool.schema.string().optional(),
          subtitle: tool.schema.string().optional(),
          abstract: tool.schema.string().optional(),
          keywords: tool.schema.string().optional(),
          bibliography: tool.schema.string().optional().describe("Path to .bib file"),
        },
        async execute(args) {
          const preset = await presetManager.loadPreset(args.preset, args.logo);
          if (preset.template?.path && !preset.resolved_template_path) {
            throw new Error(`Template '${preset.template.path}' not found. Use docs_templates_install.`);
          }
          
          // Determine output path
          const outputPath = args.output_path || computeOutputPath(args.input_path, undefined, "tex").replace(/\.pdf$/, '.tex');
          
          // Build pandoc command for LaTeX output (not PDF)
          const builder = pandoc().input(args.input_path).output(outputPath).applyPreset(preset)
            .applyMetadata({ title: args.title, author: args.author, date: args.date, subtitle: args.subtitle, abstract: args.abstract, keywords: args.keywords });
          
          if (args.bibliography) builder.bibliography(args.bibliography);
          
          // For IEEE templates, use simple tables
          const isIeee = preset.name?.includes('ieee') || args.preset?.includes('ieee');
          if (isIeee) {
            builder.simpleTables();
          }
          
          const result = await builder.execute();
          if (!result.success) throw new Error(`Failed:\n${result.error}`);
          
          return `Generated LaTeX: ${outputPath}\nPreset: ${preset.name}\n\nTo compile manually:\npdflatex ${outputPath.split('/').pop()}`;
        },
      }),

      docs_create_school_report: tool({
        description: "Create SIT/UofG school report with logo options and adjustable margins.",
        args: {
          input_path: tool.schema.string().describe("Path to Markdown file"),
          output_dir: tool.schema.string().optional().describe("Output directory"),
          logo: tool.schema.enum(["sit", "uofg", "both"]).optional().describe("Logo option: sit (top-left), uofg (top-left), both (left+right)"),
          margin: tool.schema.string().optional().describe("Uniform margin (e.g., '2.5cm')"),
          top_margin: tool.schema.string().optional().describe("Top margin (e.g., '2cm')"),
          bottom_margin: tool.schema.string().optional().describe("Bottom margin"),
          left_margin: tool.schema.string().optional().describe("Left margin"),
          right_margin: tool.schema.string().optional().describe("Right margin"),
          title: tool.schema.string().optional(),
          course: tool.schema.string().optional().describe("Course/module title"),
          project_title: tool.schema.string().optional(),
          group: tool.schema.string().optional().describe("Group name/number"),
          author: tool.schema.string().optional().describe("Single author name"),
          authors: tool.schema.string().optional().describe("JSON array of student objects: [{name, sit_id, glasgow_id}, ...]"),
          date: tool.schema.string().optional(),
          version: tool.schema.string().optional().describe("Document version (e.g., '1.1')"),
          project_topic_id: tool.schema.string().optional().describe("Project topic ID (e.g., 'N')"),
          include_toc: tool.schema.boolean().optional().describe("Include table of contents (default: true)"),
        },
        async execute(args) {
          const preset = await presetManager.loadPreset("school-report");
          if (!preset.resolved_template_path) {
            throw new Error("School report template not found at sit-uofg/template.latex");
          }

          const outputPath = computeOutputPath(args.input_path, args.output_dir, "pdf");
          const builder = pandoc().input(args.input_path).output(outputPath)
            .template(preset.resolved_template_path)
            .pdfEngine("xelatex")
            .listings();

          // Apply format
          if (preset.pandoc?.from) builder.from(preset.pandoc.from);

          // Margins
          if (args.margin) {
            builder.variable("margin", args.margin);
          } else {
            if (args.top_margin) builder.variable("top-margin", args.top_margin);
            if (args.bottom_margin) builder.variable("bottom-margin", args.bottom_margin);
            if (args.left_margin) builder.variable("left-margin", args.left_margin);
            if (args.right_margin) builder.variable("right-margin", args.right_margin);
          }

          // Logos - resolve paths from assets
          if (args.logo) {
            const assetsDir = resolver.getUserConfigDir() + "/assets";
            if (args.logo === "sit") {
              builder.variable("logo-mode", "single");
              builder.variable("sit-logo", `${assetsDir}/sit-logo.png`);
            } else if (args.logo === "uofg") {
              builder.variable("logo-mode", "single");
              builder.variable("uofg-logo", `${assetsDir}/uofg-logo.png`);
            } else if (args.logo === "both") {
              builder.variable("logo-mode", "both");
              builder.variable("sit-logo", `${assetsDir}/sit-logo.png`);
              builder.variable("uofg-logo", `${assetsDir}/uofg-logo.png`);
            }
          }

          // Title page content
          builder.variable("titlepage", true);
          if (args.title) builder.variable("title", args.title);
          if (args.course) builder.variable("course", args.course);
          if (args.project_title) builder.variable("project-title", args.project_title);
          if (args.group) builder.variable("group", args.group);
          if (args.date) builder.variable("date", args.date);

          // Version and Project Topic ID (optional)
          if (args.version) builder.variable("version", args.version);
          if (args.project_topic_id) builder.variable("project-topic-id", args.project_topic_id);

          // Authors table - parse JSON and create metadata file
          let metaFileToCleanup: string | null = null;
          if (args.authors) {
            try {
              const authorsArray = JSON.parse(args.authors) as Array<{ name: string; sit_id: string; glasgow_id: string }>;
              // Build YAML content
              const yamlLines = ["authors:"];
              for (const author of authorsArray) {
                yamlLines.push(`  - name: "${author.name}"`);
                if (author.sit_id) {
                  yamlLines.push(`    sit-id: "${author.sit_id}"`);
                }
                if (author.glasgow_id) {
                  yamlLines.push(`    glasgow-id: "${author.glasgow_id}"`);
                }
              }
              metaFileToCleanup = `/tmp/pandoc-authors-${Date.now()}.yaml`;
              const yamlContent = yamlLines.join("\n");
              await Bun.write(metaFileToCleanup, yamlContent);
              builder.metadataFile(metaFileToCleanup);
            } catch (e) {
              throw new Error(`Invalid authors JSON: ${e}`);
            }
          } else if (args.author) {
            // Single author fallback
            builder.variable("author", args.author);
          }

          // TOC
          if (args.include_toc !== false) {
            builder.toc().variable("toc-own-page", true);
          }

          // Style settings
          builder.variable("colorlinks", true);
          builder.variable("linkcolor", "blue");
          builder.variable("numbersections", true);

          const result = await builder.execute();
          if (!result.success) throw new Error(`Failed:\n${result.error}`);

          // Cleanup metadata file if created
          if (metaFileToCleanup) {
            try { await Bun.spawn(["rm", "-f", metaFileToCleanup]).exited; } catch { /* ignore cleanup errors */ }
          }

          return `Created school report: ${outputPath}\nLogo: ${args.logo || "none"}\nMargins: ${args.margin || "custom/default"}`;
        },
      }),

      docs_create_styled_pdf: tool({
        description: "Create styled PDF with title page and TOC.",
        args: {
          input_path: tool.schema.string(),
          template: tool.schema.string().optional().describe("Template (default: eisvogel)"),
          title: tool.schema.string().optional(),
          author: tool.schema.string().optional(),
          date: tool.schema.string().optional(),
          title_color: tool.schema.string().optional().describe("Hex color (default: 06386e)"),
          include_toc: tool.schema.boolean().optional(),
          output_dir: tool.schema.string().optional(),
        },
        async execute(args) {
          const tpl = resolver.resolveTemplate(args.template || "eisvogel");
          if (!tpl) throw new Error(`Template not found. Run: docs_templates_install eisvogel`);
          const outputPath = computeOutputPath(args.input_path, args.output_dir, "pdf");
          const builder = pandoc().input(args.input_path).output(outputPath).from("markdown-smart")
            .template(tpl.path).pdfEngine("xelatex").listings()
            .variable("titlepage", true).variable("titlepage-color", args.title_color || "06386e")
            .variable("titlepage-text-color", "FFFFFF").variable("colorlinks", true);
          if (args.include_toc !== false) builder.toc().variable("toc-own-page", true);
          builder.applyMetadata({ title: args.title, author: args.author, date: args.date });
          const result = await builder.execute();
          if (!result.success) throw new Error(`Failed:\n${result.error}`);
          return `Created: ${outputPath}`;
        },
      }),
    },
  };
};
