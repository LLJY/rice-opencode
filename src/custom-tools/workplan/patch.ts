import { promises as fs } from "node:fs";
import { relative, resolve } from "node:path";

import { tool } from "@opencode-ai/plugin";

import {
  assertSafePathAccess,
  isWithinWorkspaceRoot,
  normalizeWorkspaceFile,
  readOptionalFile,
  readWorkplanDocument,
  resolveLinkedPlanPath,
  resolveToolWorkspaceRoot,
} from "./shared";
import { workplan_validate } from "./validate";

type PatchHunk = {
  anchor?: string;
  oldLines: string[];
  newLines: string[];
  hasChange: boolean;
};

type RestrictedPatch = {
  target: string;
  hunks: PatchHunk[];
};

type AskContext = {
  worktree: string;
  ask(input: AskInput): unknown;
};

type AskInput = { permission: string; patterns: string[]; always: string[]; metadata: Record<string, unknown> };

type ValidationSummary = {
  valid: boolean;
  issueCount: number;
};

export const workplan_patch = tool({
  description:
    "Patch only the linked Markdown plan file for an existing workplan using a restricted opencode-style Update File patch. Use workplan_update for JSON metadata changes; omit unchanged optional fields instead of passing blank strings.",
  args: {
    workspaceRoot: tool.schema.string().optional().describe("Optional workspace root; defaults to the current workspace"),
    id: tool.schema.string().describe("Workplan id"),
    patchText: tool.schema.string().describe("Restricted patch envelope that updates only the linked Markdown planFile"),
    validate: tool.schema.boolean().optional().describe("Run workplan_validate after patching"),
  },
  async execute(args, context) {
    const workspaceRoot = resolveToolWorkspaceRoot(context, args.workspaceRoot);
    await askExternalWorkspaceIfNeeded(context, workspaceRoot);

    const { document } = await readWorkplanDocument(workspaceRoot, args.id);
    const planPath = resolveLinkedPlanPath(workspaceRoot, document);
    const patch = parseRestrictedPatch(args.patchText);
    const targetPlanFile = normalizeWorkspaceFile(workspaceRoot, patch.target, "Patch target");

    if (targetPlanFile !== document.planFile) {
      throw new Error(`Patch target must match linked planFile ${document.planFile}: ${patch.target}`);
    }

    const previousContent = await readOptionalFile(workspaceRoot, planPath, "Plan file");
    if (previousContent === null) throw new Error(`Plan file not found: ${document.planFile}`);

    const nextContent = applyPatchHunks(planPath, previousContent, patch.hunks);
    if (nextContent === previousContent) throw new Error("Patch did not change the linked plan file");

    context.metadata({
      title: "Patch workplan",
      metadata: { workspaceRoot, id: document.id, planFile: document.planFile },
    });

    await runAsk(context, {
      permission: "edit",
      patterns: [permissionPattern(context.worktree, planPath)],
      always: [permissionPattern(context.worktree, planPath)],
      metadata: {
        filepath: permissionPattern(context.worktree, planPath),
        workplan: document.id,
        planFile: document.planFile,
      },
    });

    await assertSafePathAccess(workspaceRoot, planPath, "Plan file");
    await fs.writeFile(planPath, nextContent, "utf8");

    const validation = args.validate === true ? summarizeValidation(await workplan_validate.execute({ workspaceRoot, id: document.id }, context)) : undefined;

    return {
      output: args.validate === true
        ? `Patched workplan ${document.id} plan file: ${document.planFile}`
        : `Patched workplan ${document.id} plan file: ${document.planFile}\nRun workplan_validate if you need full validation.`,
      metadata: {
        id: document.id,
        planFile: document.planFile,
        patched: true,
        validate: args.validate === true,
        validation,
      },
    };
  },
});

function parseRestrictedPatch(patchText: string): RestrictedPatch {
  const lines = trimOuterBlankLines(patchText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n"));
  if (lines[0]?.trim() !== "*** Begin Patch" || lines[lines.length - 1]?.trim() !== "*** End Patch") {
    throw new Error("Invalid patch format: missing required Begin/End markers");
  }

  const body = lines.slice(1, -1);
  if (body.length === 0 || body.every((line) => !line.trim())) throw new Error("Patch rejected: empty patch");

  let target: string | undefined;
  const hunks: PatchHunk[] = [];
  let index = 0;

  while (index < body.length) {
    const line = body[index]!;
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith("*** Add File:")) throw new Error("workplan_patch does not support Add File sections");
    if (line.startsWith("*** Delete File:")) throw new Error("workplan_patch does not support Delete File sections");
    if (line.startsWith("*** Move to:")) throw new Error("workplan_patch does not support Move to sections");
    if (!line.startsWith("*** Update File:")) throw new Error(`Invalid patch line outside an update section: ${line}`);
    if (target) throw new Error("workplan_patch allows exactly one Update File section");

    target = line.slice("*** Update File:".length).trim();
    if (!target) throw new Error("Update File section must include a target path");
    index += 1;

    if (body[index]?.startsWith("*** Move to:")) throw new Error("workplan_patch does not support Move to sections");

    while (index < body.length && !body[index]!.startsWith("***")) {
      if (!body[index]!.startsWith("@@")) throw new Error(`Patch hunks must start with @@: ${body[index]}`);

      const hunk = parseHunk(body, index);
      hunks.push(hunk.hunk);
      index = hunk.nextIndex;
    }
  }

  if (!target) throw new Error("Patch must include exactly one Update File section");
  if (hunks.length === 0) throw new Error("Patch rejected: no hunks found");
  if (!hunks.some((hunk) => hunk.hasChange)) throw new Error("Patch rejected: no additions or removals found");

  return { target, hunks };
}

function parseHunk(lines: string[], startIndex: number): { hunk: PatchHunk; nextIndex: number } {
  const anchor = lines[startIndex]!.slice(2).trim() || undefined;
  const oldLines: string[] = [];
  const newLines: string[] = [];
  let hasChange = false;
  let index = startIndex + 1;

  while (index < lines.length && !lines[index]!.startsWith("@@") && !lines[index]!.startsWith("***")) {
    const line = lines[index]!;
    if (line.startsWith(" ")) {
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
    } else if (line.startsWith("-")) {
      oldLines.push(line.slice(1));
      hasChange = true;
    } else if (line.startsWith("+")) {
      newLines.push(line.slice(1));
      hasChange = true;
    } else {
      throw new Error(`Invalid hunk line; expected space, -, or + prefix: ${line}`);
    }
    index += 1;
  }

  if (oldLines.length === 0 && newLines.length === 0) throw new Error("Patch hunk must contain at least one prefixed line");
  return { hunk: { anchor, oldLines, newLines, hasChange }, nextIndex: index };
}

function applyPatchHunks(filePath: string, content: string, hunks: PatchHunk[]): string {
  const original = splitContentLines(content);
  const replacements: Array<{ index: number; deleteCount: number; lines: string[] }> = [];
  let lineIndex = 0;

  for (const hunk of hunks) {
    if (hunk.anchor) {
      const anchorIndex = findSequence(original.lines, [hunk.anchor], lineIndex);
      if (anchorIndex < 0) throw new Error(`Failed to find context '${hunk.anchor}' in ${filePath}`);
      lineIndex = anchorIndex + 1;
    }

    if (hunk.oldLines.length === 0) {
      replacements.push({ index: lineIndex, deleteCount: 0, lines: hunk.newLines });
      continue;
    }

    const matchIndex = findSequence(original.lines, hunk.oldLines, lineIndex);
    if (matchIndex < 0) throw new Error(`Failed to find expected lines in ${filePath}:\n${hunk.oldLines.join("\n")}`);

    replacements.push({ index: matchIndex, deleteCount: hunk.oldLines.length, lines: hunk.newLines });
    lineIndex = matchIndex + hunk.oldLines.length;
  }

  const nextLines = [...original.lines];
  for (const replacement of replacements.toReversed()) {
    nextLines.splice(replacement.index, replacement.deleteCount, ...replacement.lines);
  }

  return `${nextLines.join("\n")}${original.trailingNewline ? "\n" : ""}`;
}

function splitContentLines(content: string): { lines: string[]; trailingNewline: boolean } {
  const trailingNewline = content.endsWith("\n");
  const trimmed = trailingNewline ? content.slice(0, -1) : content;
  return { lines: trimmed ? trimmed.split("\n") : [], trailingNewline };
}

function findSequence(lines: string[], pattern: string[], startIndex: number): number {
  for (let index = startIndex; index <= lines.length - pattern.length; index += 1) {
    if (pattern.every((line, offset) => lines[index + offset] === line)) return index;
  }
  return -1;
}

function trimOuterBlankLines(lines: string[]): string[] {
  const start = lines.findIndex((line) => line.trim());
  if (start < 0) return [];
  const end = lines.findLastIndex((line) => line.trim());
  return lines.slice(start, end + 1);
}

async function askExternalWorkspaceIfNeeded(context: AskContext, workspaceRoot: string): Promise<void> {
  if (isWithinWorkspaceRoot(context.worktree, workspaceRoot)) return;

  await runAsk(context, {
    permission: "external_directory",
    patterns: [externalWorkspacePattern(workspaceRoot)],
    always: [externalWorkspacePattern(workspaceRoot)],
    metadata: {
      filepath: workspaceRoot,
      parentDir: workspaceRoot,
    },
  });
}

async function runAsk(context: AskContext, input: AskInput): Promise<void> {
  await context.ask(input);
}

function externalWorkspacePattern(workspaceRoot: string): string {
  return `${workspaceRoot.replaceAll("\\", "/")}/**`;
}

function permissionPattern(worktree: string, targetPath: string): string {
  const relativePath = relative(resolve(worktree), targetPath).replaceAll("\\", "/");
  if (relativePath && !relativePath.startsWith("..")) return relativePath;
  return targetPath.replaceAll("\\", "/");
}

function summarizeValidation(result: unknown): ValidationSummary | undefined {
  if (typeof result !== "string") return undefined;

  const parsed = JSON.parse(result) as { valid?: unknown; issueCount?: unknown };
  if (typeof parsed.valid !== "boolean" || typeof parsed.issueCount !== "number") return undefined;
  return { valid: parsed.valid, issueCount: parsed.issueCount };
}
