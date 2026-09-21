import type { Config, Plugin } from "@opencode-ai/plugin";
import { fileURLToPath } from "node:url";
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

export const WORKFLOW_COMPACTION_CONTEXT = `Append this section only if an active workplan is currently being planned or executed. Otherwise, omit it entirely.

### Workflow Status
- Mode: workflow-plan | workflow-execute
- Workplan path: [exact path]
- Current step: [exact current step and status]
- Plan-checker ran: yes | no
- Continuation requirement: [workflow-plan: "Load the workflow-plan skill before continuing." | workflow-execute: "Load the workflow-execute skill before continuing."]

Preserve exact values. Do not infer an active workflow from an old, completed, cancelled, proposed, or merely discussed workplan.`;

const bundledSkillsDirectory = fileURLToPath(new URL("./skills", import.meta.url));

type ConfigWithSkillPaths = Config & {
  skills?: {
    paths?: string[];
  };
};

function registerBundledSkills(config: Config): void {
  const mutableConfig = config as ConfigWithSkillPaths;
  mutableConfig.skills ??= {};
  mutableConfig.skills.paths ??= [];

  if (!mutableConfig.skills.paths.includes(bundledSkillsDirectory)) {
    mutableConfig.skills.paths.push(bundledSkillsDirectory);
  }
}

export const RicePlugin: Plugin = async () => ({
  config: async (config) => {
    registerBundledSkills(config);
  },
  tool: {
    workplan_create,
    workplan_inspect,
    workplan_list,
    workplan_patch,
    workplan_read,
    workplan_reset,
    workplan_update,
    workplan_validate,
  },
  "experimental.session.compacting": async (_input, output) => {
    output.context.push(WORKFLOW_COMPACTION_CONTEXT);
  },
});

export default RicePlugin;
