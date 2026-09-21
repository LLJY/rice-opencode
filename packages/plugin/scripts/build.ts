import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const outputDirectory = resolve(packageRoot, "dist");

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const result = await Bun.build({
  entrypoints: [resolve(packageRoot, "src/index.ts")],
  outdir: outputDirectory,
  target: "bun",
  format: "esm",
  external: ["@opencode-ai/plugin"],
  minify: false,
  sourcemap: "external",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

for (const skill of ["workflow-plan", "workflow-execute"]) {
  await cp(
    resolve(repositoryRoot, "skills", skill),
    resolve(outputDirectory, "skills", skill),
    { recursive: true },
  );
}
