import quotaFallback from "./src/index";

export * from "./src/policy";
export {
  createQuotaState,
  fileAgentReader,
  getFallbackDiagnostics,
  handleRetry,
  PLUGIN_ID,
  resolveNextModel,
} from "./src/index";
export type { AgentFileReader, FallbackRecord, QuotaState, RetryEvent } from "./src/index";

export default quotaFallback;
