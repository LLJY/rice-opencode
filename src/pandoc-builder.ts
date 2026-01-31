import { ResolvedPreset } from "./preset-manager";

/**
 * Fluent builder for pandoc commands
 */
export class PandocBuilder {
  private args: string[] = ["pandoc"];
  private inputFile: string = "";
  private outputFile: string = "";

  /**
   * Set input file
   */
  input(path: string): this {
    this.inputFile = path;
    return this;
  }

  /**
   * Set output file
   */
  output(path: string): this {
    this.outputFile = path;
    return this;
  }

  /**
   * Set input format
   */
  from(format: string): this {
    this.args.push("-f", format);
    return this;
  }

  /**
   * Set output format
   */
  to(format: string): this {
    this.args.push("-t", format);
    return this;
  }

  /**
   * Set template path
   */
  template(path: string): this {
    this.args.push(`--template=${path}`);
    return this;
  }

  /**
   * Set PDF engine
   */
  pdfEngine(engine: "xelatex" | "pdflatex" | "lualatex"): this {
    this.args.push(`--pdf-engine=${engine}`);
    return this;
  }

  /**
   * Add a variable
   */
  variable(name: string, value: string | number | boolean): this {
    this.args.push("-V", `${name}=${value}`);
    return this;
  }

  /**
   * Add multiple variables
   */
  variables(vars: Record<string, string | number | boolean>): this {
    for (const [name, value] of Object.entries(vars)) {
      this.variable(name, value);
    }
    return this;
  }

  /**
   * Add bibliography file
   */
  bibliography(path: string): this {
    this.args.push(`--bibliography=${path}`);
    this.args.push("--citeproc");
    return this;
  }

  /**
   * Set CSL file
   */
  csl(path: string): this {
    this.args.push(`--csl=${path}`);
    return this;
  }

  /**
   * Enable table of contents
   */
  toc(): this {
    this.args.push("--toc");
    return this;
  }

  /**
   * Enable section numbering
   */
  numberSections(): this {
    this.args.push("--number-sections");
    return this;
  }

  /**
   * Enable listings for code blocks
   */
  listings(): this {
    this.args.push("--listings");
    return this;
  }

  /**
   * Enable standalone mode
   */
  standalone(): this {
    this.args.push("-s");
    return this;
  }

  /**
   * Add metadata
   */
  metadata(key: string, value: string): this {
    this.args.push("-M", `${key}=${value}`);
    return this;
  }

  /**
   * Add metadata file (YAML)
   */
  metadataFile(path: string): this {
    this.args.push(`--metadata-file=${path}`);
    return this;
  }

  /**
   * Add a raw argument
   */
  arg(arg: string): this {
    this.args.push(arg);
    return this;
  }

  /**
   * Add multiple raw arguments
   */
  rawArgs(args: string[]): this {
    this.args.push(...args);
    return this;
  }

  /**
   * Set resource path for finding auxiliary files (like .cls files)
   */
  resourcePath(path: string): this {
    this.args.push(`--resource-path=${path}`);
    return this;
  }

  /**
   * Apply a preset configuration
   */
  applyPreset(preset: ResolvedPreset): this {
    // Apply input format
    if (preset.pandoc?.from) {
      this.from(preset.pandoc.from);
    }

    // Apply template and set resource path to template directory
    if (preset.resolved_template_path) {
      this.template(preset.resolved_template_path);
      // Set resource path to template directory so LaTeX can find .cls files
      const templateDir = preset.resolved_template_path.split("/").slice(0, -1).join("/");
      if (templateDir) {
        this.resourcePath(templateDir);
      }
    }

    // Apply PDF engine
    if (preset.pdf_engine) {
      this.pdfEngine(preset.pdf_engine);
    }

    // Apply CSL
    if (preset.resolved_csl_path) {
      this.csl(preset.resolved_csl_path);
    }

    // Apply style settings as variables
    if (preset.style) {
      const style = preset.style;

      if (style.titlepage !== undefined) {
        this.variable("titlepage", style.titlepage);
      }
      if (style.titlepage_color) {
        this.variable("titlepage-color", style.titlepage_color);
      }
      if (style.text_color) {
        this.variable("titlepage-text-color", style.text_color);
        this.variable("titlepage-rule-color", style.text_color);
      }
      if (style.toc) {
        this.toc();
      }
      if (style.toc_own_page) {
        this.variable("toc-own-page", true);
      }
      if (style.number_sections) {
        this.numberSections();
      }
      if (style.colorlinks !== undefined) {
        this.variable("colorlinks", style.colorlinks);
      }
      if (style.linkcolor) {
        this.variable("linkcolor", style.linkcolor);
      }
    }

    // Apply pandoc variables
    if (preset.pandoc?.variables) {
      this.variables(preset.pandoc.variables);
    }

    // Apply extra args
    if (preset.pandoc?.extra_args) {
      this.rawArgs(preset.pandoc.extra_args);
    }

    // Apply logo if resolved
    if (preset.resolved_logo_path) {
      this.variable("logo", preset.resolved_logo_path);
      this.variable("logo-width", "150");
    }

    return this;
  }

  /**
   * Apply document metadata
   */
  applyMetadata(metadata: {
    title?: string;
    author?: string;
    date?: string;
    subtitle?: string;
    abstract?: string;
    keywords?: string | string[];
    subject?: string;
    course_code?: string;
  }): this {
    if (metadata.title) this.variable("title", metadata.title);
    if (metadata.author) this.variable("author", metadata.author);
    if (metadata.date) this.variable("date", metadata.date);
    if (metadata.subtitle) this.variable("subtitle", metadata.subtitle);
    if (metadata.abstract) this.variable("abstract", metadata.abstract);
    if (metadata.subject) this.variable("subject", metadata.subject);
    if (metadata.course_code) this.variable("course_code", metadata.course_code);

    if (metadata.keywords) {
      const keywords = Array.isArray(metadata.keywords)
        ? metadata.keywords.join(", ")
        : metadata.keywords;
      this.variable("keywords", keywords);
    }

    return this;
  }

  /**
   * Build the command array
   */
  build(): string[] {
    const cmd = [...this.args];

    if (this.inputFile) {
      cmd.push(this.inputFile);
    }

    if (this.outputFile) {
      cmd.push("-o", this.outputFile);
    }

    return cmd;
  }

  /**
   * Execute the pandoc command
   */
  async execute(): Promise<{ success: boolean; output?: string; error?: string }> {
    const cmd = this.build();

    const proc = Bun.spawn(cmd, {
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.exited;

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (proc.exitCode !== 0) {
      return {
        success: false,
        error: stderr || stdout.split("\n").slice(-30).join("\n"),
      };
    }

    return {
      success: true,
      output: stdout,
    };
  }

  /**
   * Get the command as a string (for debugging)
   */
  toString(): string {
    return this.build().join(" ");
  }
}

/**
 * Create a new pandoc builder
 */
export function pandoc(): PandocBuilder {
  return new PandocBuilder();
}

/**
 * Helper to compute output path from input path
 */
export function computeOutputPath(
  inputPath: string,
  outputDir?: string,
  outputFormat = "pdf"
): string {
  const inputDir = inputPath.split("/").slice(0, -1).join("/");
  const fileName = inputPath.split("/").pop()?.replace(/\.[^/.]+$/, "") || "output";
  const targetDir = outputDir || inputDir;
  return `${targetDir}/${fileName}.${outputFormat}`;
}

/**
 * Validate required fields in document metadata
 */
export function validateRequiredFields(
  metadata: Record<string, unknown>,
  requiredFields: string[]
): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  for (const field of requiredFields) {
    if (!metadata[field]) {
      missing.push(field);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}
