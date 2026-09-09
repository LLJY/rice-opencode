/**
 * openai-long-context — V2-only OpenCode plugin.
 *
 * A catalog transform clones every `gpt-5.6-*` model on the OpenAI provider
 * into a `<id>-1m` variant with a 1M-token context window
 * (context 1,000,000 / input 872,000 / output 128,000). Variants inherit all
 * base-model fields (capabilities, cost, compatibility, transport settings)
 * and only override identity, display name, and limits.
 *
 * The transform is idempotent and replays cleanly: re-registration derives
 * the same variant set from the same base models and refreshes existing
 * variants in place.
 */

import { Plugin } from "@opencode-ai/plugin";
import {
  applyLongContextModels,
  validateOptions,
  type LongContextOptions,
} from "./policy";

export const PLUGIN_ID = "openai-long-context";

export interface LongContextState {
  options: LongContextOptions;
}

export function createLongContextState(rawOptions?: unknown): LongContextState {
  return { options: validateOptions(rawOptions) };
}

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const state = createLongContextState(ctx.options);
    if (!state.options.enabled) return;

    await ctx.catalog.transform((editor) => {
      const created = applyLongContextModels(
        editor as unknown as Parameters<typeof applyLongContextModels>[0],
        state.options,
      );
      if (created.length > 0) {
        console.info(
          `[openai-long-context] registered ${created.length} variant(s) on '${state.options.providerID}': ${created.join(", ")}`,
        );
      }
    });
  },
});
