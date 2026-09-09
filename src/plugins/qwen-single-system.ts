import type { Plugin } from "@opencode-ai/plugin";

const TARGET_PROVIDER_ID = "vllm-hotaisle";
const TARGET_MODEL_ID = "HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive";

export function isTargetModel(model: { providerID: string; id: string }): boolean {
  return model.providerID === TARGET_PROVIDER_ID && model.id === TARGET_MODEL_ID;
}

export function mergeSystemMessages(system: string[]): void {
  if (system.length <= 1) {
    return;
  }

  system.splice(0, system.length, system.join("\n\n"));
}

const QwenSingleSystemPlugin: Plugin = async () => ({
  "experimental.chat.system.transform": async ({ model }, output) => {
    if (isTargetModel(model)) {
      mergeSystemMessages(output.system);
    }
  },
});

export default QwenSingleSystemPlugin;
