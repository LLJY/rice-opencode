import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const versions = {
  context7: "4.0.1",
  duckduckgo: "0.6.1",
  exa: "3.4.0",
  github: "v1.9.0",
  hound: "12.4.1",
} as const;

type RicePluginOptions = Record<string, unknown> & {
  credentialDirectory?: string;
};

type McpDefinition = Record<string, unknown>;

function expandHome(path: string) {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return resolve(path);
}

function credentialDirectory(options: RicePluginOptions) {
  const configured = options.credentialDirectory;
  if (typeof configured === "string" && configured.trim()) return expandHome(configured.trim());
  return join(homedir(), ".config/opencode");
}

async function readCredential(path: string) {
  try {
    const value = (await readFile(path, "utf8")).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function keyedLocal(command: string[], environmentName: string, credential?: string): McpDefinition {
  return {
    type: "local",
    command,
    enabled: Boolean(credential),
    ...(credential ? { environment: { [environmentName]: credential } } : {}),
  };
}

export async function createMcpPreset(options: RicePluginOptions, researcherBinary: string) {
  const directory = credentialDirectory(options);
  const [github, context7, exa] = await Promise.all([
    readCredential(join(directory, ".github-pat")),
    readCredential(join(directory, ".context7-api-key")),
    readCredential(join(directory, ".exa-api-key")),
  ]);

  const researcherSupported = process.platform === "linux" && process.arch === "x64";

  return {
    github: keyedLocal(
      [
        "docker",
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        `ghcr.io/github/github-mcp-server:${versions.github}`,
      ],
      "GITHUB_PERSONAL_ACCESS_TOKEN",
      github,
    ),
    deepwiki: {
      type: "remote",
      url: "https://mcp.deepwiki.com/mcp",
      enabled: true,
    },
    context7: keyedLocal(
      ["npx", "-y", `@upstash/context7-mcp@${versions.context7}`],
      "CONTEXT7_API_KEY",
      context7,
    ),
    "researcher-mcp": {
      type: "local",
      command: [researcherBinary],
      enabled: researcherSupported,
      timeout: 120_000,
    },
    hound: {
      type: "local",
      command: ["uvx", "--from", `hound-mcp[all]==${versions.hound}`, "hound"],
      enabled: true,
      timeout: 120_000,
    },
    "ddg-search": {
      type: "local",
      command: [
        "uvx",
        "--from",
        `duckduckgo-mcp-server==${versions.duckduckgo}`,
        "duckduckgo-mcp-server",
      ],
      enabled: true,
      timeout: 30_000,
    },
    exa: keyedLocal(["npx", "-y", `exa-mcp-server@${versions.exa}`], "EXA_API_KEY", exa),
  } satisfies Record<string, McpDefinition>;
}
