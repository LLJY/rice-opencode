import { DocsPlugin } from "./plugin";

const module = {
  id: "@rice-opencode/docs",
  server: DocsPlugin,
} satisfies { id: string; server: typeof DocsPlugin };

export { DocsPlugin };
export default module;
