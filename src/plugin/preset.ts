import { access, readFile, readdir } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type PresetDefinition = Record<string, unknown>;

export type RicePreset = {
  agents: Record<string, PresetDefinition>;
  commands: Record<string, PresetDefinition>;
  packageRoot: string;
  researcherBinary: string;
  skillPath: string;
};

const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
let cachedPreset: Promise<RicePreset> | undefined;

async function findPackageRoot() {
  const candidates = [resolve(runtimeDirectory, "../.."), resolve(runtimeDirectory, "..")];
  for (const candidate of candidates) {
    try {
      await Promise.all([access(join(candidate, "agents")), access(join(candidate, "skills"))]);
      return candidate;
    } catch {}
  }
  throw new Error(`Unable to locate rice-opencode assets from ${runtimeDirectory}`);
}

function parseMarkdownDefinition(source: string, sourcePath: string, contentKey: "prompt" | "template") {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error(`Missing YAML frontmatter in ${sourcePath}`);

  let frontmatter: unknown;
  try {
    frontmatter = Bun.YAML.parse(match[1] ?? "");
  } catch (cause) {
    throw new Error(`Invalid YAML frontmatter in ${sourcePath}`, { cause });
  }
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    throw new Error(`Invalid YAML frontmatter in ${sourcePath}`);
  }

  return {
    ...(frontmatter as PresetDefinition),
    [contentKey]: (match[2] ?? "").trim(),
  };
}

async function loadDirectory(
  directory: string,
  contentKey: "prompt" | "template",
  include: (definition: PresetDefinition) => boolean = () => true,
) {
  const result: Record<string, PresetDefinition> = {};
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && extname(entry.name) === ".md")
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const sourcePath = join(directory, entry.name);
    const definition = parseMarkdownDefinition(await readFile(sourcePath, "utf8"), sourcePath, contentKey);
    if (!include(definition)) continue;
    result[basename(entry.name, ".md")] = definition;
  }
  return result;
}

export function loadRicePreset() {
  cachedPreset ??= (async () => {
    const packageRoot = await findPackageRoot();
    const [agents, commands] = await Promise.all([
      loadDirectory(join(packageRoot, "agents"), "prompt", (definition) => definition.disable !== true),
      loadDirectory(join(packageRoot, "commands"), "template"),
    ]);

    return {
      agents,
      commands,
      packageRoot,
      researcherBinary: join(packageRoot, "assets/bin/linux-x64/researcher-mcp"),
      skillPath: join(packageRoot, "skills"),
    };
  })();
  return cachedPreset;
}
