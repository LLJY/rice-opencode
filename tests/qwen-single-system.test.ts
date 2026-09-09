import { describe, expect, it } from "bun:test";
import { isTargetModel, mergeSystemMessages } from "../src/plugins/qwen-single-system";

describe("Qwen single-system compatibility", () => {
  it("merges system messages in their original order", () => {
    const system = ["primary instructions", "supplemental context", "final constraints"];

    mergeSystemMessages(system);

    expect(system).toEqual([
      "primary instructions\n\nsupplemental context\n\nfinal constraints",
    ]);
  });

  it("leaves a single system message unchanged", () => {
    const system = ["primary instructions"];

    mergeSystemMessages(system);

    expect(system).toEqual(["primary instructions"]);
  });

  it("is scoped to the configured vLLM Qwen model", () => {
    expect(isTargetModel({
      providerID: "vllm-hotaisle",
      id: "HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive",
    })).toBe(true);
    expect(isTargetModel({
      providerID: "openai",
      id: "HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive",
    })).toBe(false);
    expect(isTargetModel({
      providerID: "vllm-hotaisle",
      id: "another-model",
    })).toBe(false);
  });
});
