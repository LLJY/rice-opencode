import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Plugin, type Skill } from "@opencode/plugin";
import type { Info as AgentInfo } from "@opencode/schema/agent";

// @ts-expect-error Generated before bundling; its structure is declared below.
import presetData from "../dist/preset.js";
import { createWorkspaceTool } from "../../shared/src/v2-tool";
import { viz_generate_image } from "../../viz/src/plugin";
import {
  create as workplan_create,
  inspect as workplan_inspect,
  list as workplan_list,
  patch as workplan_patch,
  read as workplan_read,
  reset as workplan_reset,
  update as workplan_update,
  validate as workplan_validate,
} from "../../../src/custom-tools/workplan";

type SkillPreset = {
  id: string;
  name: string;
  description: string;
  autoinvoke?: boolean;
  assetPath: string;
  content: string;
};

type Preset = {
  agents: Record<string, AgentInfo>;
  skills: SkillPreset[];
  reviewCommand: {
    name: string;
    description: string;
    agent: string;
    body: string;
  };
};

const preset = presetData as unknown as Preset;
const distDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist");

const workplanTools = [
  ["workplan_create", workplan_create, true],
  ["workplan_inspect", workplan_inspect, false],
  ["workplan_list", workplan_list, false],
  ["workplan_patch", workplan_patch, true],
  ["workplan_read", workplan_read, false],
  ["workplan_reset", workplan_reset, true],
  ["workplan_update", workplan_update, true],
  ["workplan_validate", workplan_validate, false],
] as const;

export const RicePluginV2 = Plugin.define({
  id: "@rice-opencode/plugin",
  async setup(context) {
    await context.tool.transform((editor) => {
      for (const [name, definition, mutates] of workplanTools) {
        editor.add(createWorkspaceTool(name, definition, context, mutates));
      }
      editor.add(createWorkspaceTool("viz_generate_image", viz_generate_image, context, true));
    });

    await context.skill.transform((editor) => {
      for (const skill of preset.skills) {
        if (editor.get(skill.id)) continue;
        editor.add({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          ...(skill.autoinvoke === undefined ? {} : { autoinvoke: skill.autoinvoke }),
          path: resolve(distDirectory, skill.assetPath),
          content: skill.content,
        } as Skill.Info);
      }
    });

    await context.agent.transform((editor) => {
      for (const [id, definition] of Object.entries(preset.agents)) {
        editor.update(id, (agent) => {
          agent.name = definition.name;
          agent.mode = definition.mode;
          agent.hidden = definition.hidden;
          agent.request = structuredClone(definition.request);
          agent.permissions.push(...structuredClone(definition.permissions));

          if (definition.model === undefined) delete agent.model;
          else agent.model = structuredClone(definition.model);
          if (definition.system === undefined) delete agent.system;
          else agent.system = definition.system;
          if (definition.description === undefined) delete agent.description;
          else agent.description = definition.description;
          if (definition.color === undefined) delete agent.color;
          else agent.color = definition.color;
          if (definition.steps === undefined) delete agent.steps;
          else agent.steps = definition.steps;
        });
      }
    });

    await context.command.transform((editor) => {
      editor.add({
        name: preset.reviewCommand.name,
        description: preset.reviewCommand.description,
        async execute({ sessionID, prompt, delivery }) {
          const agent = (await context.agent.get({ agentID: preset.reviewCommand.agent })).data;
          await context.session.switchAgent({ sessionID, agent: preset.reviewCommand.agent });
          if (agent.model) await context.session.switchModel({ sessionID, model: agent.model });
          await context.session.prompt({
            ...prompt,
            sessionID,
            text: `${preset.reviewCommand.body}${prompt.text ? `\n\n${prompt.text}` : ""}`,
            delivery,
          });
        },
      });
    });
  },
});

export default RicePluginV2;
