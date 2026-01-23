import { existsSync, readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import { TemplateResolver } from "./template-resolver";

/**
 * Preset configuration schema
 */
export interface PresetConfig {
  name: string;
  description?: string;
  extends?: string;

  template?: {
    path: string;
    document_class?: string;
    class_options?: string[];
  };

  pdf_engine?: "xelatex" | "pdflatex" | "lualatex";

  citation?: {
    style?: string;
    csl_file?: string;
  };

  pandoc?: {
    from?: string;
    variables?: Record<string, string | number | boolean>;
    extra_args?: string[];
  };

  logos?: Record<string, string>;

  style?: {
    titlepage?: boolean;
    titlepage_color?: string;
    text_color?: string;
    toc?: boolean;
    toc_own_page?: boolean;
    number_sections?: boolean;
    colorlinks?: boolean;
    linkcolor?: string;
  };

  required_fields?: string[];
  optional_fields?: string[];
}

/**
 * Resolved preset with all inheritance applied
 */
export interface ResolvedPreset extends PresetConfig {
  source_path: string;
  source_type: "project" | "user" | "builtin";
  resolved_template_path?: string;
  resolved_csl_path?: string;
  resolved_logo_path?: string;
}

/**
 * Built-in presets that are always available
 */
const BUILTIN_PRESETS: Record<string, PresetConfig> = {
  "school-report": {
    name: "school-report",
    description: "SIT/UofG School Report with optional logos and adjustable margins",
    template: {
      path: "sit-uofg/template.latex",
    },
    pdf_engine: "xelatex",
    logos: {
      sit: "assets/sit-logo.png",
      uofg: "assets/uofg-logo.png",
      both: "both", // Special marker for dual logo mode
    },
    style: {
      titlepage: true,
      toc: true,
      toc_own_page: true,
      colorlinks: true,
      linkcolor: "blue",
      number_sections: true,
    },
    pandoc: {
      from: "markdown+smart+pipe_tables",
      variables: {
        "top-margin": "2.5cm",
        "bottom-margin": "2.5cm",
        "left-margin": "2.5cm",
        "right-margin": "2.5cm",
      },
    },
    required_fields: ["title"],
    optional_fields: ["author", "date", "course", "group", "project-title", "authors"],
  },

  "ieee-conference": {
    name: "ieee-conference",
    description: "IEEE Conference Paper (two-column, US Letter)",
    template: {
      path: "ieee/template.latex",
      document_class: "IEEEtran",
      class_options: ["conference", "10pt", "letterpaper"],
    },
    pdf_engine: "pdflatex",
    citation: {
      style: "ieee",
      csl_file: "ieee.csl",
    },
    pandoc: {
      from: "markdown+citations+smart",
      variables: {
        colorlinks: true,
        linkcolor: "black",
      },
    },
    required_fields: ["title", "author", "abstract", "keywords"],
  },

  "ieee-journal": {
    name: "ieee-journal",
    description: "IEEE Journal Paper (two-column)",
    extends: "ieee-conference",
    template: {
      path: "ieee/template.latex",
      document_class: "IEEEtran",
      class_options: ["journal", "10pt", "letterpaper"],
    },
  },

  "acm-sigconf": {
    name: "acm-sigconf",
    description: "ACM SIGCONF Paper",
    template: {
      path: "acm/template.latex",
      document_class: "acmart",
      class_options: ["sigconf"],
    },
    pdf_engine: "pdflatex",
    citation: {
      style: "acm",
      csl_file: "acm-sig-proceedings.csl",
    },
    pandoc: {
      from: "markdown+citations+smart",
    },
    required_fields: ["title", "author", "abstract", "keywords"],
  },

  lncs: {
    name: "lncs",
    description: "Springer LNCS Paper",
    template: {
      path: "lncs/template.latex",
      document_class: "llncs",
    },
    pdf_engine: "pdflatex",
    citation: {
      style: "springer-lncs",
      csl_file: "springer-lncs.csl",
    },
    pandoc: {
      from: "markdown+citations+smart",
    },
    required_fields: ["title", "author", "abstract"],
  },

  eisvogel: {
    name: "eisvogel",
    description: "General purpose professional document (Eisvogel template)",
    template: {
      path: "eisvogel.latex",
    },
    pdf_engine: "xelatex",
    pandoc: {
      from: "markdown+smart",
    },
    style: {
      colorlinks: true,
      linkcolor: "blue",
    },
    required_fields: ["title"],
    optional_fields: ["author", "date", "subtitle"],
  },
};

export class PresetManager {
  private resolver: TemplateResolver;
  private cache: Map<string, ResolvedPreset> = new Map();

  constructor(resolver?: TemplateResolver) {
    this.resolver = resolver || new TemplateResolver();
  }

  /**
   * Clear the preset cache (call after installing templates)
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Load and resolve a preset by name
   */
  async loadPreset(presetName: string, logoOption?: string): Promise<ResolvedPreset> {
    const cacheKey = `${presetName}:${logoOption || ""}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    let preset: PresetConfig;
    let sourcePath = "builtin";
    let sourceType: "project" | "user" | "builtin" = "builtin";

    // Check builtin presets first
    if (BUILTIN_PRESETS[presetName]) {
      preset = structuredClone(BUILTIN_PRESETS[presetName]);
    } else {
      // Try to resolve from filesystem
      const resolved = this.resolver.resolvePreset(presetName);
      if (!resolved) {
        throw new Error(
          `Preset '${presetName}' not found. Available presets: ${this.listPresetNames().join(", ")}`
        );
      }

      const content = readFileSync(resolved.path, "utf-8");
      preset = parseYaml(content) as PresetConfig;
      sourcePath = resolved.path;
      sourceType = resolved.source;
    }

    // Handle inheritance
    if (preset.extends) {
      const parentPreset = await this.loadPreset(preset.extends);
      preset = this.mergePresets(parentPreset, preset);
    }

    // Resolve paths
    const resolvedPreset: ResolvedPreset = {
      ...preset,
      source_path: sourcePath,
      source_type: sourceType,
    };

    // Resolve template path
    if (preset.template?.path) {
      const templateResolved = this.resolver.resolveTemplate(preset.template.path);
      if (templateResolved) {
        resolvedPreset.resolved_template_path = templateResolved.path;
      }
    }

    // Resolve CSL path
    if (preset.citation?.csl_file) {
      const cslResolved = this.resolver.resolveCsl(preset.citation.csl_file);
      if (cslResolved) {
        resolvedPreset.resolved_csl_path = cslResolved.path;
      }
    }

    // Resolve logo path if specified
    if (logoOption && preset.logos) {
      const logoPath = preset.logos[logoOption];
      if (!logoPath) {
        const availableLogos = Object.keys(preset.logos).join(", ");
        throw new Error(
          `Logo option '${logoOption}' not found. Available options: ${availableLogos}`
        );
      }
      const assetResolved = this.resolver.resolveAsset(logoPath);
      if (assetResolved) {
        resolvedPreset.resolved_logo_path = assetResolved.path;
      }
    }

    this.cache.set(cacheKey, resolvedPreset);
    return resolvedPreset;
  }

  /**
   * Merge parent and child presets (child overrides parent)
   */
  private mergePresets(parent: PresetConfig | ResolvedPreset, child: PresetConfig): PresetConfig {
    return {
      ...parent,
      ...child,
      template: child.template
        ? { ...parent.template, ...child.template }
        : parent.template,
      citation: child.citation
        ? { ...parent.citation, ...child.citation }
        : parent.citation,
      pandoc: child.pandoc
        ? {
            ...parent.pandoc,
            ...child.pandoc,
            variables: {
              ...parent.pandoc?.variables,
              ...child.pandoc?.variables,
            },
            extra_args: [
              ...(parent.pandoc?.extra_args || []),
              ...(child.pandoc?.extra_args || []),
            ],
          }
        : parent.pandoc,
      logos: child.logos ? { ...parent.logos, ...child.logos } : parent.logos,
      style: child.style ? { ...parent.style, ...child.style } : parent.style,
      required_fields: child.required_fields || parent.required_fields,
      optional_fields: child.optional_fields || parent.optional_fields,
    };
  }

  /**
   * List all available preset names
   */
  listPresetNames(): string[] {
    const names = new Set<string>(Object.keys(BUILTIN_PRESETS));

    // Add presets from filesystem
    const fsPresets = this.resolver.listPresets();
    for (const preset of fsPresets) {
      names.add(preset.name);
    }

    return Array.from(names).sort();
  }

  /**
   * List all available presets with details
   */
  listPresets(): Array<{
    name: string;
    description?: string;
    source: "project" | "user" | "builtin";
    path: string;
  }> {
    const presets: Array<{
      name: string;
      description?: string;
      source: "project" | "user" | "builtin";
      path: string;
    }> = [];
    const seen = new Set<string>();

    // Add filesystem presets first (project takes precedence)
    const fsPresets = this.resolver.listPresets();
    for (const preset of fsPresets) {
      if (!seen.has(preset.name)) {
        seen.add(preset.name);
        try {
          const content = readFileSync(preset.path, "utf-8");
          const config = parseYaml(content) as PresetConfig;
          presets.push({
            name: preset.name,
            description: config.description,
            source: preset.source,
            path: preset.path,
          });
        } catch {
          presets.push({
            name: preset.name,
            source: preset.source,
            path: preset.path,
          });
        }
      }
    }

    // Add builtin presets
    for (const [name, config] of Object.entries(BUILTIN_PRESETS)) {
      if (!seen.has(name)) {
        presets.push({
          name,
          description: config.description,
          source: "builtin",
          path: "builtin",
        });
      }
    }

    return presets.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get detailed info about a preset
   */
  async getPresetInfo(presetName: string): Promise<{
    config: PresetConfig;
    source: "project" | "user" | "builtin";
    path: string;
    available_logos?: string[];
    template_available: boolean;
    csl_available: boolean;
  }> {
    let config: PresetConfig;
    let source: "project" | "user" | "builtin" = "builtin";
    let path = "builtin";

    if (BUILTIN_PRESETS[presetName]) {
      config = BUILTIN_PRESETS[presetName];
    } else {
      const resolved = this.resolver.resolvePreset(presetName);
      if (!resolved) {
        throw new Error(`Preset '${presetName}' not found`);
      }
      const content = readFileSync(resolved.path, "utf-8");
      config = parseYaml(content) as PresetConfig;
      source = resolved.source;
      path = resolved.path;
    }

    // Handle inheritance for full config
    if (config.extends) {
      const parentInfo = await this.getPresetInfo(config.extends);
      config = this.mergePresets(parentInfo.config, config);
    }

    // Check template availability
    let templateAvailable = false;
    if (config.template?.path) {
      templateAvailable = this.resolver.resolveTemplate(config.template.path) !== null;
    }

    // Check CSL availability
    let cslAvailable = false;
    if (config.citation?.csl_file) {
      cslAvailable = this.resolver.resolveCsl(config.citation.csl_file) !== null;
    }

    return {
      config,
      source,
      path,
      available_logos: config.logos ? Object.keys(config.logos) : undefined,
      template_available: templateAvailable,
      csl_available: cslAvailable,
    };
  }

  /**
   * Create a new preset file
   */
  async createPreset(
    name: string,
    config: Omit<PresetConfig, "name">,
    location: "project" | "user" = "user"
  ): Promise<string> {
    const preset: PresetConfig = { name, ...config };

    let targetDir: string;
    if (location === "project") {
      const projectDir = this.resolver.getProjectConfigDir();
      if (!projectDir) {
        throw new Error("No project directory available");
      }
      targetDir = `${projectDir}/presets`;
    } else {
      targetDir = `${this.resolver.getUserConfigDir()}/presets`;
    }

    await Bun.spawn(["mkdir", "-p", targetDir]).exited;

    const targetPath = `${targetDir}/${name}.yaml`;

    // Simple YAML serialization
    const yamlContent = this.serializeYaml(preset);
    await Bun.write(targetPath, yamlContent);

    // Clear cache
    this.cache.clear();

    return targetPath;
  }

  /**
   * Simple YAML serialization
   */
  private serializeYaml(obj: unknown, indent = 0): string {
    const spaces = "  ".repeat(indent);

    if (obj === null || obj === undefined) {
      return "null";
    }

    if (typeof obj === "string") {
      if (obj.includes("\n") || obj.includes(":") || obj.includes("#")) {
        return `"${obj.replace(/"/g, '\\"')}"`;
      }
      return obj;
    }

    if (typeof obj === "number" || typeof obj === "boolean") {
      return String(obj);
    }

    if (Array.isArray(obj)) {
      if (obj.length === 0) return "[]";
      return obj
        .map((item) => {
          if (typeof item === "object" && item !== null) {
            const serialized = this.serializeYaml(item, indent + 1);
            return `${spaces}- ${serialized.trim().replace(/\n/g, `\n${spaces}  `)}`;
          }
          return `${spaces}- ${this.serializeYaml(item, 0)}`;
        })
        .join("\n");
    }

    if (typeof obj === "object") {
      const entries = Object.entries(obj as Record<string, unknown>);
      if (entries.length === 0) return "{}";

      return entries
        .map(([key, value]) => {
          if (typeof value === "object" && value !== null && !Array.isArray(value)) {
            const nested = this.serializeYaml(value, indent + 1);
            return `${spaces}${key}:\n${nested}`;
          }
          if (Array.isArray(value)) {
            const nested = this.serializeYaml(value, indent + 1);
            return `${spaces}${key}:\n${nested}`;
          }
          return `${spaces}${key}: ${this.serializeYaml(value, 0)}`;
        })
        .join("\n");
    }

    return String(obj);
  }
}

// Export a default manager instance
export const defaultPresetManager = new PresetManager();
