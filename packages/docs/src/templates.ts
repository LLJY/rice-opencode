import { existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

/**
 * XDG-compliant path resolution for pandoc templates and presets.
 * Search order: project-local `.opencode/pandoc/` → user `~/.config/opencode/pandoc/`
 */

export interface ResolverConfig {
  projectRoot?: string;
}

export interface ResolvedPath {
  path: string;
  source: "project" | "user" | "bundled";
}

const XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const USER_PANDOC_DIR = join(XDG_CONFIG_HOME, "opencode", "pandoc");
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BUNDLED_PANDOC_DIR = join(PACKAGE_ROOT, "pandoc");

export class TemplateResolver {
  private projectRoot: string | null;
  private projectPandocDir: string | null;
  private bundledPandocDir: string;

  constructor(config: ResolverConfig = {}) {
    this.projectRoot = config.projectRoot || process.cwd();
    this.projectPandocDir = this.projectRoot
      ? join(this.projectRoot, ".opencode", "pandoc")
      : null;
    this.bundledPandocDir = BUNDLED_PANDOC_DIR;
  }

  /**
   * Get the user's pandoc config directory
   */
  getUserConfigDir(): string {
    return USER_PANDOC_DIR;
  }

  /**
   * Get the project-local pandoc config directory
   */
  getProjectConfigDir(): string | null {
    return this.projectPandocDir;
  }

  getBundledConfigDir(): string {
    return this.bundledPandocDir;
  }

  /**
   * Resolve a template path, searching project-local first, then user config
   */
  resolveTemplate(templateName: string): ResolvedPath | null {
    // If it's an absolute path, use it directly
    if (templateName.startsWith("/")) {
      if (existsSync(templateName)) {
        return { path: templateName, source: "user" };
      }
      return null;
    }

    // Search project-local first
    if (this.projectPandocDir) {
      const projectPath = join(this.projectPandocDir, "templates", templateName);
      if (existsSync(projectPath) && statSync(projectPath).isFile()) {
        return { path: projectPath, source: "project" };
      }
      // Try with .latex extension
      if (!templateName.includes(".") && existsSync(projectPath + ".latex")) {
        return { path: projectPath + ".latex", source: "project" };
      }
      // Try as directory with template.latex inside
      if (existsSync(join(projectPath, "template.latex"))) {
        return { path: join(projectPath, "template.latex"), source: "project" };
      }
    }

    // Search user config
    const userPath = join(USER_PANDOC_DIR, "templates", templateName);
    if (existsSync(userPath) && statSync(userPath).isFile()) {
      return { path: userPath, source: "user" };
    }
    // Try with .latex extension
    if (!templateName.includes(".") && existsSync(userPath + ".latex")) {
      return { path: userPath + ".latex", source: "user" };
    }
    // Try as directory with template.latex inside
    if (existsSync(join(userPath, "template.latex"))) {
      return { path: join(userPath, "template.latex"), source: "user" };
    }

    const bundledPath = join(this.bundledPandocDir, "templates", templateName);
    if (existsSync(bundledPath) && statSync(bundledPath).isFile()) {
      return { path: bundledPath, source: "bundled" };
    }
    if (!templateName.includes(".") && existsSync(bundledPath + ".latex")) {
      return { path: bundledPath + ".latex", source: "bundled" };
    }
    if (existsSync(join(bundledPath, "template.latex"))) {
      return { path: join(bundledPath, "template.latex"), source: "bundled" };
    }

    return null;
  }

  /**
   * Resolve a preset file path
   */
  resolvePreset(presetName: string): ResolvedPath | null {
    // If it's an absolute path, use it directly
    if (presetName.startsWith("/")) {
      if (existsSync(presetName)) {
        return { path: presetName, source: "user" };
      }
      return null;
    }

    const fileName = presetName.endsWith(".yaml") ? presetName : `${presetName}.yaml`;

    // Search project-local first
    if (this.projectPandocDir) {
      const projectPath = join(this.projectPandocDir, "presets", fileName);
      if (existsSync(projectPath)) {
        return { path: projectPath, source: "project" };
      }
      // Check organizations subdirectory
      const orgPath = join(this.projectPandocDir, "presets", "organizations", fileName);
      if (existsSync(orgPath)) {
        return { path: orgPath, source: "project" };
      }
    }

    // Search user config
    const userPath = join(USER_PANDOC_DIR, "presets", fileName);
    if (existsSync(userPath)) {
      return { path: userPath, source: "user" };
    }
    // Check organizations subdirectory
    const userOrgPath = join(USER_PANDOC_DIR, "presets", "organizations", fileName);
    if (existsSync(userOrgPath)) {
      return { path: userOrgPath, source: "user" };
    }

    return null;
  }

  /**
   * Resolve a CSL file path
   */
  resolveCsl(cslName: string): ResolvedPath | null {
    // If it's an absolute path, use it directly
    if (cslName.startsWith("/")) {
      if (existsSync(cslName)) {
        return { path: cslName, source: "user" };
      }
      return null;
    }

    const fileName = cslName.endsWith(".csl") ? cslName : `${cslName}.csl`;

    // Search project-local first
    if (this.projectPandocDir) {
      const projectPath = join(this.projectPandocDir, "csl", fileName);
      if (existsSync(projectPath)) {
        return { path: projectPath, source: "project" };
      }
    }

    // Search user config
    const userPath = join(USER_PANDOC_DIR, "csl", fileName);
    if (existsSync(userPath)) {
      return { path: userPath, source: "user" };
    }

    return null;
  }

  /**
   * Resolve an asset path (for logos, images, etc.)
   */
  resolveAsset(assetPath: string): ResolvedPath | null {
    // If it's an absolute path, use it directly
    if (assetPath.startsWith("/")) {
      if (existsSync(assetPath)) {
        return { path: assetPath, source: "user" };
      }
      return null;
    }

    // Search project-local first
    if (this.projectPandocDir) {
      const projectPath = join(this.projectPandocDir, assetPath);
      if (existsSync(projectPath)) {
        return { path: projectPath, source: "project" };
      }
    }

    // Search user config
    const userPath = join(USER_PANDOC_DIR, assetPath);
    if (existsSync(userPath)) {
      return { path: userPath, source: "user" };
    }

    // Also check project root assets
    if (this.projectRoot) {
      const rootAssetPath = join(this.projectRoot, assetPath);
      if (existsSync(rootAssetPath)) {
        return { path: rootAssetPath, source: "project" };
      }
    }

    const bundledPath = join(this.bundledPandocDir, assetPath);
    if (existsSync(bundledPath)) {
      return { path: bundledPath, source: "bundled" };
    }

    return null;
  }

  /**
   * List all available templates
   */
  listTemplates(): Array<{ name: string; source: "project" | "user" | "bundled"; path: string }> {
    const templates: Array<{ name: string; source: "project" | "user" | "bundled"; path: string }> = [];
    const seen = new Set<string>();

    const scanDir = (dir: string, source: "project" | "user" | "bundled") => {
      if (!existsSync(dir)) return;
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          if (!entry) continue;
          const name = entry.replace(/\.latex$/, "");
          if (seen.has(name)) continue;
          seen.add(name);

          const entryPath = join(dir, entry);
          if (statSync(entryPath).isDirectory()) {
            // It's a directory - check for template.latex inside
            if (existsSync(join(entryPath, "template.latex"))) {
              templates.push({ name, source, path: join(entryPath, "template.latex") });
            }
          } else if (entry.endsWith(".latex")) {
            templates.push({ name, source, path: entryPath });
          }
        }
      } catch {
        // Directory doesn't exist or can't be read
      }
    };

    // Scan project-local first (takes precedence)
    if (this.projectPandocDir) {
      scanDir(join(this.projectPandocDir, "templates"), "project");
    }

    // Then scan user config
    scanDir(join(USER_PANDOC_DIR, "templates"), "user");

    // Finally scan bundled package templates
    scanDir(join(this.bundledPandocDir, "templates"), "bundled");

    return templates;
  }

  /**
   * List all available presets
   */
  listPresets(): Array<{ name: string; source: "project" | "user"; path: string }> {
    const presets: Array<{ name: string; source: "project" | "user"; path: string }> = [];
    const seen = new Set<string>();

    const scanDir = (dir: string, source: "project" | "user") => {
      if (!existsSync(dir)) return;
      try {
        const files = walkFiles(dir, (file) => file.endsWith(".yaml"));
        for (const file of files) {
          if (!file) continue;
          const name = file.split("/").pop()?.replace(/\.yaml$/, "") || "";
          if (seen.has(name)) continue;
          seen.add(name);
          presets.push({ name, source, path: file });
        }
      } catch {
        // Directory doesn't exist or can't be read
      }
    };

    // Scan project-local first (takes precedence)
    if (this.projectPandocDir) {
      scanDir(join(this.projectPandocDir, "presets"), "project");
    }

    // Then scan user config
    scanDir(join(USER_PANDOC_DIR, "presets"), "user");

    return presets;
  }

  /**
   * List all available CSL styles
   */
  listCslStyles(): Array<{ name: string; source: "project" | "user"; path: string }> {
    const styles: Array<{ name: string; source: "project" | "user"; path: string }> = [];
    const seen = new Set<string>();

    const scanDir = (dir: string, source: "project" | "user") => {
      if (!existsSync(dir)) return;
      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          if (!entry || !entry.endsWith(".csl")) continue;
          const name = entry.replace(/\.csl$/, "");
          if (seen.has(name)) continue;
          seen.add(name);
          styles.push({ name, source, path: join(dir, entry) });
        }
      } catch {
        // Directory doesn't exist or can't be read
      }
    };

    // Scan project-local first (takes precedence)
    if (this.projectPandocDir) {
      scanDir(join(this.projectPandocDir, "csl"), "project");
    }

    // Then scan user config
    scanDir(join(USER_PANDOC_DIR, "csl"), "user");

    return styles;
  }

  /**
   * Ensure the user config directory structure exists
   */
  async ensureUserConfigDirs(): Promise<void> {
    const dirs = [
      USER_PANDOC_DIR,
      join(USER_PANDOC_DIR, "templates"),
      join(USER_PANDOC_DIR, "templates", "ieee"),
      join(USER_PANDOC_DIR, "templates", "acm"),
      join(USER_PANDOC_DIR, "templates", "lncs"),
      join(USER_PANDOC_DIR, "templates", "custom"),
      join(USER_PANDOC_DIR, "csl"),
      join(USER_PANDOC_DIR, "presets"),
      join(USER_PANDOC_DIR, "presets", "organizations"),
      join(USER_PANDOC_DIR, "assets"),
    ];

    for (const dir of dirs) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

function walkFiles(dir: string, matcher: (path: string) => boolean): string[] {
  if (!existsSync(dir)) return [];

  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const entryPath = join(dir, entry);
    const stat = statSync(entryPath);
    if (stat.isDirectory()) {
      files.push(...walkFiles(entryPath, matcher));
      continue;
    }
    if (matcher(entryPath)) {
      files.push(entryPath);
    }
  }

  return files;
}

// Export a default resolver instance
export const defaultResolver = new TemplateResolver();
