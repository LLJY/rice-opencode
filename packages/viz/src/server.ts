import { VizPlugin } from "./plugin";

const module = {
  id: "@rice-opencode/viz",
  server: VizPlugin,
} satisfies { id: string; server: typeof VizPlugin };

export { VizPlugin };
export default module;
