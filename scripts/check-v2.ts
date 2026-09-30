import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { parseOption } from "@opencode/core/config/markdown";
import { normalize } from "@opencode/core/config/normalize";
import { Host } from "@opencode/plugin/host";
import { Info } from "@opencode/schema/config";
import { Schema } from "effect";

const root = resolve(import.meta.dir, "..");
const raw: unknown = JSON.parse(await readFile(resolve(root, "opencode.v2.json"), "utf8"));
const config = Schema.decodeUnknownSync(Info, { onExcessProperty: "error" })(raw);
const normalized = normalize(raw);
assert.equal(normalized.type, "normalized", JSON.stringify(normalized.diagnostics));
assert.deepEqual(normalized.diagnostics, [], "V2 config has normalization diagnostics");
if (normalized.type === "normalized") {
  Schema.decodeUnknownSync(Info, { onExcessProperty: "error" })(normalized.encoded);
}

let definitions = 0;
for (const [directory, key, bodyKey] of [["agents", "agent", "prompt"], ["commands", "command", "template"]] as const) {
  for (const file of await readdir(resolve(root, directory))) {
    if (!file.endsWith(".md")) continue;
    const source = await readFile(resolve(root, directory, file), "utf8");
    const markdown = parseOption(source);
    assert.ok(markdown, `Invalid frontmatter: ${directory}/${file}`);
    const result = normalize({
      [key]: { [file.slice(0, -3)]: { ...markdown.data, [bodyKey]: markdown.content } },
    });
    assert.equal(result.type, "normalized", `Cannot normalize ${directory}/${file}`);
    assert.deepEqual(result.diagnostics, [], `${directory}/${file} has V2 compatibility diagnostics`);
    definitions += 1;
  }
}

const localPlugins: string[] = [];
for (const entry of config.plugins ?? []) {
  const target = typeof entry === "string" ? entry : entry.package;
  if (!target.startsWith(".")) continue;

  const server = Host.resolve({ directory: resolve(root, target) }).server;
  assert.ok(server, `No native server entrypoint for ${target}`);
  const loaded = await Host.load(server) as { default?: { id?: string; setup?: unknown } };
  assert.equal(typeof loaded.default?.id, "string", `Missing plugin ID: ${target}`);
  assert.equal(typeof loaded.default?.setup, "function", `Not a native V2 plugin: ${target}`);
  localPlugins.push(loaded.default!.id!);
}

assert.deepEqual(localPlugins, ["@rice-opencode/plugin"]);
console.log(JSON.stringify({ config: "opencode.v2.json", sdk: "2.0.20", nativePlugins: localPlugins, definitions, diagnostics: 0 }));
