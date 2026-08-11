import type { Config, Plugin } from "@opencode-ai/plugin";
import {
  create,
  inspect,
  list,
  patch,
  read,
  reset,
  update,
  validate,
} from "../custom-tools/workplan";
import { createMcpPreset } from "./mcp";
import { loadRicePreset, type PresetDefinition } from "./preset";

export type RicePluginOptions = {
  credentialDirectory?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeDefinition(defaults: PresetDefinition, override: unknown) {
  if (!isRecord(override)) return { ...defaults };
  const merged = { ...defaults, ...override };
  if (isRecord(defaults.permission) && isRecord(override.permission)) {
    merged.permission = { ...defaults.permission, ...override.permission };
  }
  return merged;
}

async function applyRiceConfig(config: Config, options: RicePluginOptions) {
  const preset = await loadRicePreset();
  const mutable = config as any;

  mutable.agent ??= {};
  for (const [name, definition] of Object.entries(preset.agents)) {
    mutable.agent[name] = mergeDefinition(definition, mutable.agent[name]);
  }

  mutable.command ??= {};
  for (const [name, definition] of Object.entries(preset.commands)) {
    mutable.command[name] = mergeDefinition(definition, mutable.command[name]);
  }

  mutable.skills ??= {};
  mutable.skills.paths ??= [];
  if (!mutable.skills.paths.includes(preset.skillPath)) mutable.skills.paths.push(preset.skillPath);

  mutable.tools ??= {};
  mutable.tools.hound_smart_search ??= false;

  mutable.mcp ??= {};
  const mcp = await createMcpPreset(options as Record<string, unknown> & RicePluginOptions, preset.researcherBinary);
  for (const [name, definition] of Object.entries(mcp)) {
    mutable.mcp[name] ??= definition;
  }
}

export const RicePlugin: Plugin = async (_input, rawOptions) => {
  const options = (rawOptions ?? {}) as RicePluginOptions;
  return {
    tool: {
      workplan_create: create,
      workplan_inspect: inspect,
      workplan_list: list,
      workplan_patch: patch,
      workplan_read: read,
      workplan_reset: reset,
      workplan_update: update,
      workplan_validate: validate,
    },
    config: async (config) => applyRiceConfig(config, options),
  };
};

export default RicePlugin;
