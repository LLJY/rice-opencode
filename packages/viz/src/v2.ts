import { Plugin } from "@opencode/plugin";

import { createWorkspaceTool } from "../../shared/src/v2-tool";
import { viz_generate_image } from "./plugin";

export const VizPluginV2 = Plugin.define({
  id: "@rice-opencode/viz",
  async setup(context) {
    await context.tool.transform((editor) => {
      editor.add(createWorkspaceTool("viz_generate_image", viz_generate_image, context, true));
    });
  },
});

export default VizPluginV2;
