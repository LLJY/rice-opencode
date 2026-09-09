import tokenSaver from "./src/index";

export * from "./src/policy";
export * from "./src/meter";
export * from "./src/slim";
export {
  createTokenSaverState,
  getStatus,
  PLUGIN_ID,
} from "./src/index";
export type { TokenSaverState } from "./src/index";

export default tokenSaver;
