import { afterEach, describe, expect, it } from "bun:test";
import { closeSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { generateImage, resolveVizConfig, VizPlugin } from "./plugin";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]);
const PNG_BASE64 = PNG_BYTES.toString("base64");

function makeCtx() {
  const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
  return {
    ctx: { directory: worktree, worktree },
    worktree,
  };
}

function makeSuccessResponse(result = PNG_BASE64, revisedPrompt = "Rewritten prompt"): Response {
  return new Response(JSON.stringify({
    id: "resp_123",
    output: [{
      type: "image_generation_call",
      result,
      revised_prompt: revisedPrompt,
    }],
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const createdWorktrees: string[] = [];
const createdFiles: string[] = [];

afterEach(() => {
  for (const filePath of createdFiles.splice(0)) {
    rmSync(filePath, { force: true });
  }

  for (const worktree of createdWorktrees.splice(0)) {
    rmSync(worktree, { recursive: true, force: true });
  }
});

describe("generateImage", () => {
  it("reuses openai provider options from OpenCode config", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    const configPath = join(worktree, "opencode.json");
    writeFileSync(configPath, `{
      // JSONC comments are allowed in live config
      "provider": {
        "openai": {
          "options": {
            "baseURL": "http://127.0.0.1:2455/v1/",
            "apiKey": "test-localhost-key",
          },
        },
      },
    }`);

    const config = resolveVizConfig({ VIZ_OPENCODE_CONFIG_FILE: configPath });

    expect(config.baseUrl).toBe("http://127.0.0.1:2455/v1");
    expect(config.apiKey).toBe("test-localhost-key");
  });

  it("does not read broken OpenCode config when env config is complete", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    const configPath = join(worktree, "broken-opencode.json");
    writeFileSync(configPath, "not json");

    const config = resolveVizConfig({
      VIZ_OPENCODE_CONFIG_FILE: configPath,
      VIZ_OPENAI_BASE_URL: "http://env-base/v1",
      VIZ_OPENAI_API_KEY: "env-key",
    });

    expect(config.baseUrl).toBe("http://env-base/v1");
    expect(config.apiKey).toBe("env-key");
  });

  it("lets empty VIZ api key clear generic OPENAI api key", () => {
    const config = resolveVizConfig({
      VIZ_OPENAI_API_KEY: "",
      OPENAI_API_KEY: "generic-openai-key",
    });

    expect(config.apiKey).toBeUndefined();
  });

  it("lets empty VIZ base URL clear generic OPENAI base URL", () => {
    const config = resolveVizConfig({
      VIZ_OPENAI_BASE_URL: "",
      OPENAI_BASE_URL: "http://generic-openai/v1",
      VIZ_OPENCODE_CONFIG_CONTENT: JSON.stringify({
        provider: {
          openai: {
            options: {
              baseURL: "http://provider-base/v1",
            },
          },
        },
      }),
    });

    expect(config.baseUrl).toBe("http://provider-base/v1");
  });

  it("resolves env placeholders from OpenCode provider config", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    const configPath = join(worktree, "opencode-env.json");
    writeFileSync(configPath, JSON.stringify({
      provider: {
        openai: {
          options: {
            baseURL: "{env:LOCAL_OPENAI_BASE_URL}",
            apiKey: "{env:LOCAL_OPENAI_API_KEY}",
          },
        },
      },
    }));

    const config = resolveVizConfig({
      VIZ_OPENCODE_CONFIG_FILE: configPath,
      LOCAL_OPENAI_BASE_URL: "http://placeholder-base/v1",
      LOCAL_OPENAI_API_KEY: "placeholder-key",
    });

    expect(config.baseUrl).toBe("http://placeholder-base/v1");
    expect(config.apiKey).toBe("placeholder-key");
  });

  it("normalizes env placeholder values from OpenCode provider config", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    const configPath = join(worktree, "opencode-env-normalized.json");
    writeFileSync(configPath, JSON.stringify({
      provider: {
        openai: {
          options: {
            baseURL: "{env:LOCAL_OPENAI_BASE_URL}",
            apiKey: "{env:LOCAL_OPENAI_API_KEY}",
          },
        },
      },
    }));

    const config = resolveVizConfig({
      VIZ_OPENCODE_CONFIG_FILE: configPath,
      LOCAL_OPENAI_BASE_URL: "  http://placeholder-base/v1  ",
      LOCAL_OPENAI_API_KEY: "placeholder-key\n",
    });

    expect(config.baseUrl).toBe("http://placeholder-base/v1");
    expect(config.apiKey).toBe("placeholder-key");
  });

  it("lets whitespace env placeholders clear lower provider values", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    const customConfigPath = join(worktree, "custom-opencode.json");
    writeFileSync(customConfigPath, JSON.stringify({
      provider: { openai: { options: { apiKey: "custom-key", baseURL: "http://custom-base/v1" } } },
    }));
    writeFileSync(join(worktree, "opencode.json"), JSON.stringify({
      provider: {
        openai: {
          options: {
            baseURL: "{env:LOCAL_OPENAI_BASE_URL}",
            apiKey: "{env:LOCAL_OPENAI_API_KEY}",
          },
        },
      },
    }));

    const config = resolveVizConfig({
      OPENCODE_CONFIG: customConfigPath,
      LOCAL_OPENAI_BASE_URL: "   ",
      LOCAL_OPENAI_API_KEY: "\n",
    }, worktree);

    expect(config.baseUrl).toBe("http://127.0.0.1:2455/v1");
    expect(config.apiKey).toBeUndefined();
  });

  it("resolves file placeholders from OpenCode provider config", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    const keyPath = join(worktree, "openai-key.txt");
    const configPath = join(worktree, "opencode-file.json");
    writeFileSync(keyPath, "file-key\n");
    writeFileSync(configPath, JSON.stringify({
      provider: {
        openai: {
          options: {
            apiKey: `{file:${keyPath}}`,
          },
        },
      },
    }));

    const config = resolveVizConfig({ VIZ_OPENCODE_CONFIG_FILE: configPath });

    expect(config.apiKey).toBe("file-key");
  });

  it("resolves relative file placeholders from config directory", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    const secretDir = join(worktree, "secrets");
    const configPath = join(worktree, "opencode-relative-file.json");
    mkdirSync(secretDir);
    writeFileSync(join(secretDir, "openai-key"), "relative-file-key\n");
    writeFileSync(configPath, JSON.stringify({
      provider: {
        openai: {
          options: {
            apiKey: "{file:secrets/openai-key}",
          },
        },
      },
    }));

    const config = resolveVizConfig({ VIZ_OPENCODE_CONFIG_FILE: configPath });

    expect(config.apiKey).toBe("relative-file-key");
  });

  it("resolves tilde file placeholders", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    const keyName = `.viz-plugin-key-${process.pid}-${Date.now()}`;
    const keyPath = join(homedir(), keyName);
    const configPath = join(worktree, "opencode-tilde-file.json");
    createdFiles.push(keyPath);

    writeFileSync(keyPath, "tilde-file-key\n");
    writeFileSync(configPath, JSON.stringify({
      provider: {
        openai: {
          options: {
            apiKey: `{file:~/${keyName}}`,
          },
        },
      },
    }));

    const config = resolveVizConfig({ VIZ_OPENCODE_CONFIG_FILE: configPath });

    expect(config.apiKey).toBe("tilde-file-key");
  });

  it("honors OPENCODE_CONFIG custom config path", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    const configPath = join(worktree, "custom-opencode.json");
    writeFileSync(configPath, JSON.stringify({
      provider: {
        openai: {
          options: {
            apiKey: "custom-config-key",
          },
        },
      },
    }));

    const config = resolveVizConfig({ OPENCODE_CONFIG: configPath });

    expect(config.apiKey).toBe("custom-config-key");
  });

  it("falls through stale higher-priority config paths", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    const configPath = join(worktree, "valid-opencode.json");
    writeFileSync(configPath, JSON.stringify({
      provider: {
        openai: {
          options: {
            apiKey: "fallback-config-key",
          },
        },
      },
    }));

    const config = resolveVizConfig({
      VIZ_OPENCODE_CONFIG_FILE: join(worktree, "missing-opencode.json"),
      OPENCODE_CONFIG: configPath,
    });

    expect(config.apiKey).toBe("fallback-config-key");
  });

  it("does not use malformed placeholders as literal config values", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    const configPath = join(worktree, "malformed-placeholder.json");
    writeFileSync(configPath, JSON.stringify({
      provider: {
        openai: {
          options: {
            baseURL: "{env:LOCAL_OPENAI_BASE_URL",
            apiKey: "{file:~/secret",
          },
        },
      },
    }));

    const config = resolveVizConfig({ VIZ_OPENCODE_CONFIG_FILE: configPath });

    expect(config.baseUrl).toBe("http://127.0.0.1:2455/v1");
    expect(config.apiKey).toBeUndefined();
  });

  it("does not use embedded env placeholders as literal config values", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    const configPath = join(worktree, "embedded-env-placeholder.json");
    writeFileSync(configPath, JSON.stringify({
      provider: {
        openai: {
          options: {
            baseURL: "https://proxy/{env:TENANT}/v1",
            apiKey: "prefix-{env:LOCAL_OPENAI_API_KEY}-suffix",
          },
        },
      },
    }));

    const config = resolveVizConfig({ VIZ_OPENCODE_CONFIG_FILE: configPath });

    expect(config.baseUrl).toBe("http://127.0.0.1:2455/v1");
    expect(config.apiKey).toBeUndefined();
  });

  it("does not use embedded file placeholders as literal config values", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    const configPath = join(worktree, "embedded-file-placeholder.json");
    writeFileSync(configPath, JSON.stringify({
      provider: {
        openai: {
          options: {
            apiKey: "prefix-{file:secret-key}-suffix",
          },
        },
      },
    }));

    const config = resolveVizConfig({ VIZ_OPENCODE_CONFIG_FILE: configPath });

    expect(config.apiKey).toBeUndefined();
  });

  it("does not use placeholder fragments from env placeholder values", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    const configPath = join(worktree, "env-placeholder-fragment.json");
    writeFileSync(configPath, JSON.stringify({
      provider: { openai: { options: { apiKey: "{env:LOCAL_OPENAI_API_KEY}" } } },
    }));

    const config = resolveVizConfig({
      VIZ_OPENCODE_CONFIG_FILE: configPath,
      LOCAL_OPENAI_API_KEY: "{env:REAL_KEY}",
    });

    expect(config.apiKey).toBeUndefined();
  });

  it("does not use placeholder fragments from file placeholder values", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    const keyPath = join(worktree, "key.txt");
    const configPath = join(worktree, "file-placeholder-fragment.json");
    writeFileSync(keyPath, "{env:REAL_KEY}\n");
    writeFileSync(configPath, JSON.stringify({
      provider: { openai: { options: { apiKey: "{file:key.txt}" } } },
    }));

    const config = resolveVizConfig({ VIZ_OPENCODE_CONFIG_FILE: configPath });

    expect(config.apiKey).toBeUndefined();
  });

  it("merges content overrides with lower file config", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    const configPath = join(worktree, "base-opencode.json");
    writeFileSync(configPath, JSON.stringify({
      provider: {
        openai: {
          options: {
            apiKey: "base-file-key",
          },
        },
      },
    }));

    const config = resolveVizConfig({
      VIZ_OPENCODE_CONFIG_FILE: configPath,
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ small_model: "openai/gpt-test" }),
    });

    expect(config.apiKey).toBe("base-file-key");
  });

  it("discovers project opencode.json provider config", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    writeFileSync(join(worktree, "opencode.json"), JSON.stringify({
      provider: {
        openai: {
          options: {
            apiKey: "project-json-key",
          },
        },
      },
    }));

    const config = resolveVizConfig({}, worktree);

    expect(config.apiKey).toBe("project-json-key");
  });

  it("discovers project opencode.jsonc provider config", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    writeFileSync(join(worktree, "opencode.jsonc"), `{
      "provider": {
        "openai": {
          "options": {
            "apiKey": "project-jsonc-key",
          },
        },
      },
    }`);

    const config = resolveVizConfig({}, worktree);

    expect(config.apiKey).toBe("project-jsonc-key");
  });

  it("discovers OPENCODE_CONFIG_DIR opencode.jsonc provider config", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    writeFileSync(join(worktree, "opencode.jsonc"), `{
      "provider": {
        "openai": {
          "options": {
            "apiKey": "dir-jsonc-key",
          },
        },
      },
    }`);

    const config = resolveVizConfig({ OPENCODE_CONFIG_DIR: worktree });

    expect(config.apiKey).toBe("dir-jsonc-key");
  });

  it("uses project config over OPENCODE_CONFIG", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    const customConfigPath = join(worktree, "custom-opencode.json");
    writeFileSync(customConfigPath, JSON.stringify({
      provider: { openai: { options: { apiKey: "custom-key" } } },
    }));
    writeFileSync(join(worktree, "opencode.json"), JSON.stringify({
      provider: { openai: { options: { apiKey: "project-key" } } },
    }));

    const config = resolveVizConfig({ OPENCODE_CONFIG: customConfigPath }, worktree);

    expect(config.apiKey).toBe("project-key");
  });

  it("uses nested current-directory config over repo-root config", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    const nestedDir = join(worktree, "packages", "app");
    createdWorktrees.push(worktree);

    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(worktree, "opencode.json"), JSON.stringify({
      provider: { openai: { options: { apiKey: "root-key" } } },
    }));
    writeFileSync(join(nestedDir, "opencode.json"), JSON.stringify({
      provider: { openai: { options: { apiKey: "nested-key" } } },
    }));

    const config = resolveVizConfig({}, worktree, nestedDir);

    expect(config.apiKey).toBe("nested-key");
  });

  it("uses OPENCODE_CONFIG_DIR over .opencode config", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    const configDir = mkdtempSync(join(tmpdir(), "viz-plugin-config-"));
    createdWorktrees.push(worktree, configDir);

    mkdirSync(join(worktree, ".opencode"));
    writeFileSync(join(worktree, ".opencode", "opencode.json"), JSON.stringify({
      provider: { openai: { options: { apiKey: "dot-opencode-key" } } },
    }));
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify({
      provider: { openai: { options: { apiKey: "dir-key" } } },
    }));

    const config = resolveVizConfig({ OPENCODE_CONFIG_DIR: configDir }, worktree);

    expect(config.apiKey).toBe("dir-key");
  });

  it("lets higher-priority null config clear lower api keys", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    const customConfigPath = join(worktree, "custom-opencode.json");
    writeFileSync(customConfigPath, JSON.stringify({
      provider: { openai: { options: { apiKey: "custom-key" } } },
    }));
    writeFileSync(join(worktree, "opencode.json"), JSON.stringify({
      provider: { openai: { options: { apiKey: null } } },
    }));

    const config = resolveVizConfig({ OPENCODE_CONFIG: customConfigPath }, worktree);

    expect(config.apiKey).toBeUndefined();
  });

  it("lets higher-priority empty config clear lower base URLs", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    const customConfigPath = join(worktree, "custom-opencode.json");
    writeFileSync(customConfigPath, JSON.stringify({
      provider: { openai: { options: { baseURL: "http://custom-base/v1" } } },
    }));
    writeFileSync(join(worktree, "opencode.json"), JSON.stringify({
      provider: { openai: { options: { baseURL: "" } } },
    }));

    const config = resolveVizConfig({ OPENCODE_CONFIG: customConfigPath }, worktree);

    expect(config.baseUrl).toBe("http://127.0.0.1:2455/v1");
  });

  it("lets empty file placeholders clear lower api keys", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    const customConfigPath = join(worktree, "custom-opencode.json");
    const emptyKeyPath = join(worktree, "empty-key");
    writeFileSync(customConfigPath, JSON.stringify({
      provider: { openai: { options: { apiKey: "custom-key" } } },
    }));
    writeFileSync(emptyKeyPath, "  \n");
    writeFileSync(join(worktree, "opencode.json"), JSON.stringify({
      provider: { openai: { options: { apiKey: "{file:empty-key}" } } },
    }));

    const config = resolveVizConfig({ OPENCODE_CONFIG: customConfigPath }, worktree);

    expect(config.apiKey).toBeUndefined();
  });

  it("lets empty file placeholders clear lower base URLs", () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    const customConfigPath = join(worktree, "custom-opencode.json");
    const emptyUrlPath = join(worktree, "empty-url");
    writeFileSync(customConfigPath, JSON.stringify({
      provider: { openai: { options: { baseURL: "http://custom-base/v1" } } },
    }));
    writeFileSync(emptyUrlPath, "\n");
    writeFileSync(join(worktree, "opencode.json"), JSON.stringify({
      provider: { openai: { options: { baseURL: "{file:empty-url}" } } },
    }));

    const config = resolveVizConfig({ OPENCODE_CONFIG: customConfigPath }, worktree);

    expect(config.baseUrl).toBe("http://127.0.0.1:2455/v1");
  });

  it("uses ctx.directory when ctx.worktree is missing", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    createdWorktrees.push(worktree);

    const result = await generateImage({ directory: worktree }, {
      prompt: "cat",
      output_path: "missing-worktree.png",
    }, {
      fetchImpl: async () => makeSuccessResponse(),
      sleep: async () => {},
    });

    expect(result.output_path).toBe(join(worktree, "missing-worktree.png"));
    expect(existsSync(join(worktree, "missing-worktree.png"))).toBe(true);
  });

  it("uses process cwd when plugin context has no root fields", async () => {
    const worktree = mkdtempSync(join(tmpdir(), "viz-plugin-"));
    const previousCwd = process.cwd();
    createdWorktrees.push(worktree);

    try {
      process.chdir(worktree);
      const result = await generateImage({}, {
        prompt: "cat",
        output_path: "cwd-fallback.png",
      }, {
        fetchImpl: async () => makeSuccessResponse(),
        sleep: async () => {},
      });

      expect(result.output_path).toBe(join(worktree, "cwd-fallback.png"));
      expect(existsSync(join(worktree, "cwd-fallback.png"))).toBe(true);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("uses home directory when plugin cwd is root", async () => {
    const previousCwd = process.cwd();
    const outputPath = join(homedir(), "viz-plugin-home-fallback.png");
    createdFiles.push(outputPath);

    try {
      process.chdir("/");
      const result = await generateImage({}, {
        prompt: "cat",
        output_path: "viz-plugin-home-fallback.png",
        overwrite: true,
      }, {
        fetchImpl: async () => makeSuccessResponse(),
        sleep: async () => {},
      });

      expect(result.output_path).toBe(outputPath);
      expect(existsSync(outputPath)).toBe(true);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("exposes only the prompt-first image generation tool", async () => {
    const { ctx, worktree } = makeCtx();
    createdWorktrees.push(worktree);

    const plugin = await VizPlugin(ctx as never);

    expect(Object.keys(plugin.tool ?? {}).sort()).toEqual(["viz_generate_image"]);
  });

  it("rejects output paths outside the worktree", async () => {
    const { ctx, worktree } = makeCtx();
    createdWorktrees.push(worktree);

    await expect(generateImage(ctx, {
      prompt: "cat",
      output_path: "../escape.png",
    }, {
      fetchImpl: async () => makeSuccessResponse(),
      sleep: async () => {},
    })).rejects.toThrow("output_path must stay within the current worktree");
  });

  it("rejects absolute output paths", async () => {
    const { ctx, worktree } = makeCtx();
    createdWorktrees.push(worktree);

    await expect(generateImage(ctx, {
      prompt: "cat",
      output_path: join(worktree, "absolute.png"),
    }, {
      fetchImpl: async () => makeSuccessResponse(),
      sleep: async () => {},
    })).rejects.toThrow("output_path must be relative");
  });

  it("rejects backslash path separators on POSIX", async () => {
    const { ctx, worktree } = makeCtx();
    createdWorktrees.push(worktree);

    await expect(generateImage(ctx, {
      prompt: "cat",
      output_path: "safe\\..\\..\\escaped.png",
    }, {
      fetchImpl: async () => makeSuccessResponse(),
      sleep: async () => {},
    })).rejects.toThrow("forward slashes");
  });

  it("rejects non-png output paths", async () => {
    const { ctx, worktree } = makeCtx();
    createdWorktrees.push(worktree);

    await expect(generateImage(ctx, {
      prompt: "cat",
      output_path: "image.jpg",
    }, {
      fetchImpl: async () => makeSuccessResponse(),
      sleep: async () => {},
    })).rejects.toThrow("output_path must end with .png");
  });

  it("rejects raw slash path forms even when they normalize to root files", async () => {
    const { ctx, worktree } = makeCtx();
    createdWorktrees.push(worktree);

    for (const outputPath of ["./out.png", "subdir/../out.png"]) {
      await expect(generateImage(ctx, {
        prompt: "cat",
        output_path: outputPath,
      }, {
        fetchImpl: async () => makeSuccessResponse(),
        sleep: async () => {},
      })).rejects.toThrow("current worktree root");
    }
  });

  it("rejects overlong filenames without exposing proc fd paths", async () => {
    const { ctx, worktree } = makeCtx();
    createdWorktrees.push(worktree);

    try {
      await generateImage(ctx, {
        prompt: "cat",
        output_path: `${"a".repeat(260)}.png`,
      }, {
        fetchImpl: async () => makeSuccessResponse(),
        sleep: async () => {},
      });
      throw new Error("Expected generateImage to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("filename is too long");
      expect((error as Error).message).not.toContain("/proc/self/fd");
    }
  });

  it("refuses to overwrite existing files by default", async () => {
    const { ctx, worktree } = makeCtx();
    createdWorktrees.push(worktree);

    const outputPath = join(worktree, "existing.png");
    writeFileSync(outputPath, "existing");

    await expect(generateImage(ctx, {
      prompt: "cat",
      output_path: "existing.png",
    }, {
      fetchImpl: async () => makeSuccessResponse(),
      sleep: async () => {},
    })).rejects.toThrow("Refusing to overwrite existing file");
  });

  it("rejects nested output paths", async () => {
    const { ctx, worktree } = makeCtx();
    const outside = mkdtempSync(join(tmpdir(), "viz-plugin-outside-"));
    createdWorktrees.push(worktree, outside);

    await expect(generateImage(ctx, {
      prompt: "cat",
      output_path: "escape/out.png",
      overwrite: true,
    }, {
      fetchImpl: async () => makeSuccessResponse(),
      sleep: async () => {},
    })).rejects.toThrow("current worktree root");

    expect(existsSync(join(outside, "out.png"))).toBe(false);
  });

  it("rejects existing symlink output targets even with overwrite", async () => {
    const { ctx, worktree } = makeCtx();
    const outside = mkdtempSync(join(tmpdir(), "viz-plugin-outside-"));
    createdWorktrees.push(worktree, outside);

    const outsideTarget = join(outside, "linked.png");
    symlinkSync(outsideTarget, join(worktree, "linked.png"));

    await expect(generateImage(ctx, {
      prompt: "cat",
      output_path: "linked.png",
      overwrite: true,
    }, {
      fetchImpl: async () => makeSuccessResponse(),
      sleep: async () => {},
    })).rejects.toThrow("symbolic link");

    expect(existsSync(outsideTarget)).toBe(false);
  });

  it("rejects output targets swapped to symlinks after preflight", async () => {
    const { ctx, worktree } = makeCtx();
    const outside = mkdtempSync(join(tmpdir(), "viz-plugin-outside-"));
    createdWorktrees.push(worktree, outside);

    const outsideTarget = join(outside, "race.png");
    const worktreeTarget = join(worktree, "race.png");

    await expect(generateImage(ctx, {
      prompt: "cat",
      output_path: "race.png",
      overwrite: true,
    }, {
      fetchImpl: async () => {
        symlinkSync(outsideTarget, worktreeTarget);
        return makeSuccessResponse();
      },
      sleep: async () => {},
    })).rejects.toThrow("symbolic link");

    expect(existsSync(outsideTarget)).toBe(false);
  });

  it("replaces hard-linked output targets without modifying outside links", async () => {
    const { ctx, worktree } = makeCtx();
    const outside = mkdtempSync(join(tmpdir(), "viz-plugin-outside-"));
    createdWorktrees.push(worktree, outside);

    const outsideTarget = join(outside, "shared.png");
    const worktreeTarget = join(worktree, "shared.png");
    writeFileSync(outsideTarget, "outside-original");
    linkSync(outsideTarget, worktreeTarget);

    const result = await generateImage(ctx, {
      prompt: "cat",
      output_path: "shared.png",
      overwrite: true,
    }, {
      fetchImpl: async () => makeSuccessResponse(),
      sleep: async () => {},
    });

    expect(result.bytes).toBe(PNG_BYTES.byteLength);
    expect(readFileSync(outsideTarget, "utf8")).toBe("outside-original");
    expect(readFileSync(worktreeTarget)).toEqual(PNG_BYTES);
  });

  it("overwrites valid long root-level filenames", async () => {
    const { ctx, worktree } = makeCtx();
    createdWorktrees.push(worktree);

    const longName = `${"a".repeat(240)}.png`;
    const outputPath = join(worktree, longName);
    writeFileSync(outputPath, "original");

    const result = await generateImage(ctx, {
      prompt: "cat",
      output_path: longName,
      overwrite: true,
    }, {
      fetchImpl: async () => makeSuccessResponse(),
      sleep: async () => {},
    });

    expect(result.bytes).toBe(PNG_BYTES.byteLength);
    expect(readFileSync(outputPath)).toEqual(PNG_BYTES);
    expect(readdirSync(worktree).filter((name) => name.startsWith(".viz-"))).toEqual([]);
  });

  it("removes a new output file after mid-write failure", async () => {
    const { ctx, worktree } = makeCtx();
    createdWorktrees.push(worktree);

    const outputPath = join(worktree, "partial-new.png");

    await expect(generateImage(ctx, {
      prompt: "cat",
      output_path: "partial-new.png",
    }, {
      fetchImpl: async () => makeSuccessResponse(),
      sleep: async () => {},
      writeFileImpl: (fileDescriptor) => {
        writeFileSync(fileDescriptor, PNG_BYTES.subarray(0, 4));
        throw new Error("simulated ENOSPC");
      },
    })).rejects.toThrow("Failed to write image output");

    expect(existsSync(outputPath)).toBe(false);
  });

  it("removes overwrite temp files after mid-write failure", async () => {
    const { ctx, worktree } = makeCtx();
    createdWorktrees.push(worktree);

    const outputPath = join(worktree, "partial-overwrite.png");
    writeFileSync(outputPath, "original");

    await expect(generateImage(ctx, {
      prompt: "cat",
      output_path: "partial-overwrite.png",
      overwrite: true,
    }, {
      fetchImpl: async () => makeSuccessResponse(),
      sleep: async () => {},
      writeFileImpl: (fileDescriptor) => {
        writeFileSync(fileDescriptor, PNG_BYTES.subarray(0, 4));
        throw new Error("simulated EIO");
      },
    })).rejects.toThrow("Failed to write image output");

    expect(readFileSync(outputPath, "utf8")).toBe("original");
    expect(readdirSync(worktree).filter((name) => name.startsWith(".viz-"))).toEqual([]);
  });

  it("removes a new output file after close failure", async () => {
    const { ctx, worktree } = makeCtx();
    createdWorktrees.push(worktree);

    const outputPath = join(worktree, "close-new.png");

    await expect(generateImage(ctx, {
      prompt: "cat",
      output_path: "close-new.png",
    }, {
      fetchImpl: async () => makeSuccessResponse(),
      sleep: async () => {},
      closeFileImpl: (fileDescriptor) => {
        closeSync(fileDescriptor);
        throw new Error("simulated close ENOSPC");
      },
    })).rejects.toThrow("Failed to write image output");

    expect(existsSync(outputPath)).toBe(false);
  });

  it("removes overwrite temp files after close failure", async () => {
    const { ctx, worktree } = makeCtx();
    createdWorktrees.push(worktree);

    const outputPath = join(worktree, "close-overwrite.png");
    writeFileSync(outputPath, "original");

    await expect(generateImage(ctx, {
      prompt: "cat",
      output_path: "close-overwrite.png",
      overwrite: true,
    }, {
      fetchImpl: async () => makeSuccessResponse(),
      sleep: async () => {},
      closeFileImpl: (fileDescriptor) => {
        closeSync(fileDescriptor);
        throw new Error("simulated close EIO");
      },
    })).rejects.toThrow("Failed to write image output");

    expect(readFileSync(outputPath, "utf8")).toBe("original");
    expect(readdirSync(worktree).filter((name) => name.startsWith(".viz-"))).toEqual([]);
  });

  it("rejects late-created nested parent paths", async () => {
    const { ctx, worktree } = makeCtx();
    const outside = mkdtempSync(join(tmpdir(), "viz-plugin-outside-"));
    createdWorktrees.push(worktree, outside);

    await expect(generateImage(ctx, {
      prompt: "cat",
      output_path: "late-parent/out.png",
      overwrite: true,
    }, {
      fetchImpl: async () => {
        symlinkSync(outside, join(worktree, "late-parent"), "dir");
        return makeSuccessResponse();
      },
      sleep: async () => {},
    })).rejects.toThrow("current worktree root");

    expect(existsSync(join(outside, "out.png"))).toBe(false);
  });

  it("rejects worktree root swaps during image generation", async () => {
    const { ctx, worktree } = makeCtx();
    const outside = mkdtempSync(join(tmpdir(), "viz-plugin-outside-"));
    const movedWorktree = `${worktree}-moved`;
    createdWorktrees.push(worktree, outside, movedWorktree);

    await expect(generateImage(ctx, {
      prompt: "cat",
      output_path: "root-swap.png",
      overwrite: true,
    }, {
      fetchImpl: async () => {
        renameSync(worktree, movedWorktree);
        symlinkSync(outside, worktree, "dir");
        return makeSuccessResponse();
      },
      sleep: async () => {},
    })).rejects.toThrow("worktree changed");

    expect(existsSync(join(outside, "root-swap.png"))).toBe(false);
    expect(existsSync(join(movedWorktree, "root-swap.png"))).toBe(false);
  });

  it("rejects symlinked worktree roots before binding output", async () => {
    const { ctx, worktree } = makeCtx();
    const outside = mkdtempSync(join(tmpdir(), "viz-plugin-outside-"));
    const movedWorktree = `${worktree}-moved`;
    createdWorktrees.push(worktree, outside, movedWorktree);

    renameSync(worktree, movedWorktree);
    symlinkSync(outside, worktree, "dir");

    await expect(generateImage(ctx, {
      prompt: "cat",
      output_path: "prebind-root-swap.png",
      overwrite: true,
    }, {
      fetchImpl: async () => makeSuccessResponse(),
      sleep: async () => {},
    })).rejects.toThrow("worktree root must not be a symbolic link");

    expect(existsSync(join(outside, "prebind-root-swap.png"))).toBe(false);
    expect(existsSync(join(movedWorktree, "prebind-root-swap.png"))).toBe(false);
  });

  it("rejects same-path worktree directory replacement during image generation", async () => {
    const { ctx, worktree } = makeCtx();
    const movedWorktree = `${worktree}-moved`;
    createdWorktrees.push(worktree, movedWorktree);

    await expect(generateImage(ctx, {
      prompt: "cat",
      output_path: "same-path-swap.png",
      overwrite: true,
    }, {
      fetchImpl: async () => {
        renameSync(worktree, movedWorktree);
        mkdirSync(worktree);
        return makeSuccessResponse();
      },
      sleep: async () => {},
    })).rejects.toThrow("worktree changed");

    expect(existsSync(join(worktree, "same-path-swap.png"))).toBe(false);
    expect(existsSync(join(movedWorktree, "same-path-swap.png"))).toBe(false);
  });

  it("rejects worktree replacement with symlink to original inode", async () => {
    const { ctx, worktree } = makeCtx();
    const movedWorktree = `${worktree}-moved`;
    createdWorktrees.push(worktree, movedWorktree);

    await expect(generateImage(ctx, {
      prompt: "cat",
      output_path: "same-inode-symlink.png",
      overwrite: true,
    }, {
      fetchImpl: async () => {
        renameSync(worktree, movedWorktree);
        symlinkSync(movedWorktree, worktree, "dir");
        return makeSuccessResponse();
      },
      sleep: async () => {},
    })).rejects.toThrow("worktree changed");

    expect(existsSync(join(worktree, "same-inode-symlink.png"))).toBe(false);
    expect(existsSync(join(movedWorktree, "same-inode-symlink.png"))).toBe(false);
  });

  it("rejects worktree swaps during the final write phase", async () => {
    const { ctx, worktree } = makeCtx();
    const outside = mkdtempSync(join(tmpdir(), "viz-plugin-outside-"));
    const movedWorktree = `${worktree}-moved`;
    createdWorktrees.push(worktree, outside, movedWorktree);

    await expect(generateImage(ctx, {
      prompt: "cat",
      output_path: "final-write-swap.png",
      overwrite: true,
    }, {
      fetchImpl: async () => makeSuccessResponse(),
      beforeFinalWrite: () => {
        renameSync(worktree, movedWorktree);
        symlinkSync(outside, worktree, "dir");
      },
      sleep: async () => {},
    })).rejects.toThrow("worktree changed");

    expect(existsSync(join(outside, "final-write-swap.png"))).toBe(false);
    expect(existsSync(join(movedWorktree, "final-write-swap.png"))).toBe(false);
  });

  it("rolls back a new file when worktree changes after write", async () => {
    const { ctx, worktree } = makeCtx();
    const outside = mkdtempSync(join(tmpdir(), "viz-plugin-outside-"));
    const movedWorktree = `${worktree}-moved`;
    createdWorktrees.push(worktree, outside, movedWorktree);

    await expect(generateImage(ctx, {
      prompt: "cat",
      output_path: "post-write-new.png",
    }, {
      fetchImpl: async () => makeSuccessResponse(),
      afterFinalWrite: () => {
        renameSync(worktree, movedWorktree);
        symlinkSync(outside, worktree, "dir");
      },
      sleep: async () => {},
    })).rejects.toThrow("worktree changed");

    expect(existsSync(join(outside, "post-write-new.png"))).toBe(false);
    expect(existsSync(join(movedWorktree, "post-write-new.png"))).toBe(false);
  });

  it("restores overwritten files when worktree changes after write", async () => {
    const { ctx, worktree } = makeCtx();
    const outside = mkdtempSync(join(tmpdir(), "viz-plugin-outside-"));
    const movedWorktree = `${worktree}-moved`;
    createdWorktrees.push(worktree, outside, movedWorktree);

    writeFileSync(join(worktree, "post-write-overwrite.png"), "original");

    await expect(generateImage(ctx, {
      prompt: "cat",
      output_path: "post-write-overwrite.png",
      overwrite: true,
    }, {
      fetchImpl: async () => makeSuccessResponse(),
      afterFinalWrite: () => {
        renameSync(worktree, movedWorktree);
        symlinkSync(outside, worktree, "dir");
      },
      sleep: async () => {},
    })).rejects.toThrow("worktree changed");

    expect(existsSync(join(outside, "post-write-overwrite.png"))).toBe(false);
    expect(readFileSync(join(movedWorktree, "post-write-overwrite.png"), "utf8")).toBe("original");
  });

  it("does not expose upstream error bodies in thrown messages", async () => {
    const { ctx, worktree } = makeCtx();
    createdWorktrees.push(worktree);

    try {
      await generateImage(ctx, {
        prompt: "cat",
        output_path: "http-error.png",
      }, {
        fetchImpl: async () => new Response(`upstream leaked base64 ${PNG_BASE64}`, { status: 400 }),
        sleep: async () => {},
      });
      throw new Error("Expected generateImage to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("HTTP 400");
      expect((error as Error).message).not.toContain(PNG_BASE64);
      expect((error as Error).message).not.toContain("upstream leaked base64");
    }
  });

  it("does not expose malformed success response bodies in thrown messages", async () => {
    const { ctx, worktree } = makeCtx();
    createdWorktrees.push(worktree);

    try {
      await generateImage(ctx, {
        prompt: "cat",
        output_path: "bad-json.png",
      }, {
        fetchImpl: async () => new Response(`not json ${PNG_BASE64}`, { status: 200 }),
        sleep: async () => {},
      });
      throw new Error("Expected generateImage to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("not valid JSON");
      expect((error as Error).message).not.toContain(PNG_BASE64);
      expect((error as Error).message).not.toContain("not json");
    }
  });

  it("fails when image_generation_call output is missing", async () => {
    const { ctx, worktree } = makeCtx();
    createdWorktrees.push(worktree);

    await expect(generateImage(ctx, {
      prompt: "cat",
      output_path: "missing-call.png",
    }, {
      fetchImpl: async () => new Response(JSON.stringify({ id: "resp_123", output: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      sleep: async () => {},
    })).rejects.toThrow("missing image_generation_call");
  });

  it("fails when result is malformed base64", async () => {
    const { ctx, worktree } = makeCtx();
    createdWorktrees.push(worktree);

    await expect(generateImage(ctx, {
      prompt: "cat",
      output_path: "bad-base64.png",
    }, {
      fetchImpl: async () => makeSuccessResponse("not-base64!!"),
      sleep: async () => {},
    })).rejects.toThrow("not valid base64");
  });

  it("fails when decoded bytes are not a png", async () => {
    const { ctx, worktree } = makeCtx();
    createdWorktrees.push(worktree);

    await expect(generateImage(ctx, {
      prompt: "cat",
      output_path: "not-png.png",
    }, {
      fetchImpl: async () => makeSuccessResponse(Buffer.from("hello").toString("base64")),
      sleep: async () => {},
    })).rejects.toThrow("Generated image is not a PNG");
  });

  it("retries transient http failures and then writes the png", async () => {
    const { ctx, worktree } = makeCtx();
    createdWorktrees.push(worktree);

    let attempts = 0;
    const outputPath = join(worktree, "retry-success.png");

    const result = await generateImage(ctx, {
      prompt: "cat",
      output_path: "retry-success.png",
    }, {
      fetchImpl: async () => {
        attempts += 1;
        if (attempts < 3) {
          return new Response("stream_incomplete upstream", { status: 503 });
        }
        return makeSuccessResponse();
      },
      sleep: async () => {},
    });

    expect(attempts).toBe(3);
    expect(result.bytes).toBe(PNG_BYTES.byteLength);
    expect(result.output_path).toBe(outputPath);
    expect(result.response_id).toBe("resp_123");
    expect(result.revised_prompt).toBe("Rewritten prompt");
    expect(existsSync(outputPath)).toBe(true);
  });

  it("retries transient markers in successful response bodies", async () => {
    const { ctx, worktree } = makeCtx();
    createdWorktrees.push(worktree);

    let attempts = 0;
    const outputPath = join(worktree, "retry-200-marker.png");

    const result = await generateImage(ctx, {
      prompt: "cat",
      output_path: "retry-200-marker.png",
    }, {
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response("stream_incomplete upstream", { status: 200 });
        }
        return makeSuccessResponse();
      },
      sleep: async () => {},
    });

    expect(attempts).toBe(2);
    expect(result.bytes).toBe(PNG_BYTES.byteLength);
    expect(existsSync(outputPath)).toBe(true);
  });

  it("does not retry transient marker phrases inside valid JSON fields", async () => {
    const { ctx, worktree } = makeCtx();
    createdWorktrees.push(worktree);

    let attempts = 0;
    const result = await generateImage(ctx, {
      prompt: "cat",
      output_path: "marker-in-json.png",
    }, {
      fetchImpl: async () => {
        attempts += 1;
        return makeSuccessResponse(PNG_BASE64, "composition note: websocket closed visual metaphor");
      },
      sleep: async () => {},
    });

    expect(attempts).toBe(1);
    expect(result.bytes).toBe(PNG_BYTES.byteLength);
    expect(result.revised_prompt).toBe("composition note: websocket closed visual metaphor");
    expect(existsSync(join(worktree, "marker-in-json.png"))).toBe(true);
  });
});
