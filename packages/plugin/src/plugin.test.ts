import { describe, expect, it } from "bun:test";

import RicePlugin, { RicePluginV2 } from "./index";

describe("native main entrypoint", () => {
  it("forwards the V2 plugin without legacy hooks", () => {
    expect(RicePlugin).toBe(RicePluginV2);
    expect(RicePlugin.id).toBe("@rice-opencode/plugin");
    expect(Object.keys(RicePlugin).sort()).toEqual(["id", "setup"]);
  });
});
