import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, type Stats } from "fs";
import { homedir } from "os";
import { dirname, extname, isAbsolute, join, relative, resolve } from "path";
import { type Plugin, tool } from "@opencode-ai/plugin";

const DEFAULT_BASE_URL = "http://127.0.0.1:2455/v1";
const DEFAULT_MODEL = "gpt-5.5";
const RESPONSE_PATH = "/responses";
const RETRY_DELAYS_MS = [500, 1500] as const;
const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_FILENAME_BYTES = 255;
const DEFAULT_OPENCODE_CONFIG_DIR = join(homedir(), ".config", "opencode");

type PluginContext = {
  worktree?: string;
  directory?: string;
  cwd?: string;
};

export interface VizGenerateImageArgs {
  prompt: string;
  output_path: string;
  overwrite?: boolean;
}

export interface VizGenerateImageResult {
  output_path: string;
  bytes: number;
  model: string;
  response_id: string;
  revised_prompt?: string;
}

interface VizConfig {
  apiKey?: string;
  baseUrl: string;
  model: string;
}

interface OpenAIProviderConfig {
  apiKey?: string;
  baseUrl?: string;
}

interface OpenCodeConfigSource {
  contents: string;
  path?: string;
}

type ResolvedConfigString = string | null | undefined;

interface ResponsesApiResponse {
  id?: unknown;
  output?: unknown;
}

interface ImageGenerationCall {
  result: string;
  revised_prompt?: string;
}

interface GenerateImageDependencies {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  beforeFinalWrite?: () => void;
  afterFinalWrite?: () => void;
  writeFileImpl?: (fileDescriptor: number, imageBytes: Uint8Array) => void;
  closeFileImpl?: (fileDescriptor: number) => void;
}

interface BoundOutputRoot {
  workspaceRoot: string;
  rootFd: number;
  rootDev: number;
  rootIno: number;
  outputPath: string;
  pathParts: string[];
}

interface WriteOutcome {
  commit(): void;
  rollback(): void;
}

function getWorkspaceRoot(ctx: PluginContext): string {
  const root = ctx.worktree || ctx.directory || ctx.cwd || process.cwd();
  return resolve(!root || root === "/" ? homedir() : root);
}

function isWithinDirectory(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function tryLstat(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}

function resolveOutputPathFromWorkspace(workspaceRoot: string, outputPath: string): string {
  if (isAbsolute(outputPath)) {
    throw new Error("output_path must be relative to the current worktree.");
  }

  if (outputPath.includes("\\")) {
    throw new Error("output_path must use forward slashes, not backslashes.");
  }

  const resolvedPath = resolve(workspaceRoot, outputPath);

  if (!isWithinDirectory(workspaceRoot, resolvedPath)) {
    throw new Error("output_path must stay within the current worktree.");
  }

  if (outputPath.includes("/")) {
    throw new Error("output_path must be a PNG filename in the current worktree root.");
  }

  if (Buffer.byteLength(outputPath, "utf8") > MAX_FILENAME_BYTES) {
    throw new Error("output_path filename is too long.");
  }

  const relativePath = relative(workspaceRoot, resolvedPath);
  if (!relativePath || relativePath.includes("/")) {
    throw new Error("output_path must be a PNG filename in the current worktree root.");
  }

  if (extname(resolvedPath).toLowerCase() !== ".png") {
    throw new Error("output_path must end with .png.");
  }

  return resolvedPath;
}

export function resolveOutputPath(ctx: PluginContext, outputPath: string): string {
  return resolveOutputPathFromWorkspace(getWorkspaceRoot(ctx), outputPath);
}

function assertNoSymlinkPathComponents(workspaceRoot: string, resolvedPath: string): void {
  const pathParts = relative(workspaceRoot, resolvedPath).split("/").filter(Boolean);
  let currentPath = workspaceRoot;

  for (const part of pathParts.slice(0, -1)) {
    currentPath = resolve(currentPath, part);
    const stats = tryLstat(currentPath);

    if (!stats) {
      return;
    }

    if (stats.isSymbolicLink()) {
      throw new Error("output_path must not pass through symbolic links.");
    }

    if (!stats.isDirectory()) {
      throw new Error("output_path parent components must be directories.");
    }
  }
}

function assertOutputTargetSafe(resolvedPath: string, overwrite = false): void {
  const stats = tryLstat(resolvedPath);

  if (!stats) {
    return;
  }

  if (stats.isSymbolicLink()) {
    throw new Error("output_path must not be a symbolic link.");
  }

  if (!stats.isFile()) {
    throw new Error("output_path must be a file path.");
  }

  if (overwrite !== true) {
    throw new Error("Refusing to overwrite existing file without overwrite=true.");
  }
}

function preflightWritableOutputPath(ctx: PluginContext, resolvedPath: string, overwrite = false): void {
  const workspaceRoot = getWorkspaceRoot(ctx);

  assertNoSymlinkPathComponents(workspaceRoot, resolvedPath);
  assertOutputTargetSafe(resolvedPath, overwrite);
}

function getNoFollowFlag(): number {
  if (typeof constants.O_NOFOLLOW !== "number") {
    throw new Error("Secure image writes require O_NOFOLLOW support.");
  }

  return constants.O_NOFOLLOW;
}

function procChildPath(directoryFd: number, childName: string): string {
  return `/proc/self/fd/${directoryFd}/${childName}`;
}

function getOutputPathParts(workspaceRoot: string, resolvedPath: string): string[] {
  const parts = relative(workspaceRoot, resolvedPath).split("/").filter(Boolean);
  if (parts.length === 0) {
    throw new Error("output_path must include a PNG file name.");
  }

  return parts;
}

function bindOutputRoot(ctx: PluginContext, outputPath: string): BoundOutputRoot {
  const workspaceRoot = getWorkspaceRoot(ctx);
  let rootFd: number;

  try {
    rootFd = openSync(workspaceRoot, constants.O_RDONLY | constants.O_DIRECTORY | getNoFollowFlag());
  } catch (error) {
    if (hasErrorCode(error, "ELOOP") || (hasErrorCode(error, "ENOTDIR") && tryLstat(workspaceRoot)?.isSymbolicLink())) {
      throw new Error("worktree root must not be a symbolic link.");
    }

    if (hasErrorCode(error, "ENOTDIR")) {
      throw new Error("worktree root must be a directory.");
    }

    throw error;
  }

  const rootStats = fstatSync(rootFd);

  try {
    const resolvedPath = resolveOutputPathFromWorkspace(workspaceRoot, outputPath);
    const pathParts = getOutputPathParts(workspaceRoot, resolvedPath);

    return {
      workspaceRoot,
      rootFd,
      rootDev: rootStats.dev,
      rootIno: rootStats.ino,
      outputPath: resolvedPath,
      pathParts,
    };
  } catch (error) {
    closeSync(rootFd);
    throw error;
  }
}

function closeBoundOutputRoot(boundOutput: BoundOutputRoot): void {
  closeSync(boundOutput.rootFd);
}

function assertBoundRootStillCurrent(boundOutput: BoundOutputRoot): void {
  try {
    const currentRootStats = lstatSync(boundOutput.workspaceRoot);
    if (
      currentRootStats.isDirectory()
      && !currentRootStats.isSymbolicLink()
      && currentRootStats.dev === boundOutput.rootDev
      && currentRootStats.ino === boundOutput.rootIno
    ) {
      return;
    }
  } catch {
    // Fall through to the stable error below.
  }

  throw new Error("worktree changed during image generation; refusing to write output_path.");
}

function closeAll(fileDescriptors: number[]): void {
  for (const fileDescriptor of fileDescriptors.reverse()) {
    closeSync(fileDescriptor);
  }
}

function preflightBoundOutputPath(boundOutput: BoundOutputRoot, overwrite = false): void {
  let currentFd = boundOutput.rootFd;
  const directoryFds: number[] = [];

  try {
    for (const part of boundOutput.pathParts.slice(0, -1)) {
      const childPath = procChildPath(currentFd, part);
      const stats = tryLstat(childPath);

      if (!stats) {
        return;
      }

      if (stats.isSymbolicLink()) {
        throw new Error("output_path must not pass through symbolic links.");
      }

      if (!stats.isDirectory()) {
        throw new Error("output_path parent components must be directories.");
      }

      currentFd = openDirectoryNoFollow(childPath);
      directoryFds.push(currentFd);
    }

    assertOutputTargetSafe(procChildPath(currentFd, boundOutput.pathParts[boundOutput.pathParts.length - 1]), overwrite);
  } finally {
    closeAll(directoryFds);
  }
}

function openDirectoryNoFollow(path: string): number {
  try {
    return openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | getNoFollowFlag());
  } catch (error) {
    if (hasErrorCode(error, "ELOOP") || (hasErrorCode(error, "ENOTDIR") && tryLstat(path)?.isSymbolicLink())) {
      throw new Error("output_path must not pass through symbolic links.");
    }

    if (hasErrorCode(error, "ENOTDIR")) {
      throw new Error("output_path parent components must be directories.");
    }

    throw error;
  }
}

function openOrCreateChildDirectory(parentFd: number, childName: string): number {
  const childPath = procChildPath(parentFd, childName);

  try {
    return openDirectoryNoFollow(childPath);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      throw error;
    }
  }

  try {
    mkdirSync(childPath, { mode: 0o700 });
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) {
      throw error;
    }
  }

  return openDirectoryNoFollow(childPath);
}

function withBoundParentDirectory<T>(
  boundOutput: BoundOutputRoot,
  callback: (parentFd: number, fileName: string) => T,
): T {
  const pathParts = boundOutput.pathParts;
  const fileName = pathParts[pathParts.length - 1];
  const directoryFds: number[] = [];

  try {
    let currentFd = boundOutput.rootFd;

    for (const part of pathParts.slice(0, -1)) {
      currentFd = openOrCreateChildDirectory(currentFd, part);
      directoryFds.push(currentFd);
    }

    return callback(currentFd, fileName);
  } finally {
    for (const fd of directoryFds.reverse()) {
      closeSync(fd);
    }
  }
}

function assertBoundOutputTargetSafe(parentFd: number, fileName: string, overwrite = false): void {
  const stats = tryLstat(procChildPath(parentFd, fileName));

  if (!stats) {
    return;
  }

  if (stats.isSymbolicLink()) {
    throw new Error("output_path must not be a symbolic link.");
  }

  if (!stats.isFile()) {
    throw new Error("output_path must be a file path.");
  }

  if (overwrite !== true) {
    throw new Error("Refusing to overwrite existing file without overwrite=true.");
  }
}

function tryUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Best-effort cleanup only.
  }
}

function isSafeWriteError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.startsWith("Refusing to overwrite")
    || error.message.startsWith("output_path must")
    || error.message.startsWith("worktree changed");
}

function throwSanitizedWriteError(error: unknown): never {
  if (isSafeWriteError(error)) {
    throw error;
  }

  throw new Error("Failed to write image output.");
}

function writeBytesToPath(
  path: string,
  imageBytes: Uint8Array,
  flags: number,
  writeFileImpl: (fileDescriptor: number, imageBytes: Uint8Array) => void,
  closeFileImpl: (fileDescriptor: number) => void,
): void {
  let fileDescriptor: number | undefined;
  let opened = false;
  let completed = false;

  try {
    fileDescriptor = openSync(path, flags, 0o600);
    opened = true;
    writeFileImpl(fileDescriptor, imageBytes);
    const closingDescriptor = fileDescriptor;
    fileDescriptor = undefined;
    closeFileImpl(closingDescriptor);
    completed = true;
  } catch (error) {
    if (fileDescriptor !== undefined) {
      const closingDescriptor = fileDescriptor;
      fileDescriptor = undefined;
      try {
        closeFileImpl(closingDescriptor);
      } catch {
        // Preserve the original write error.
      }
    }

    if (opened && !completed) {
      tryUnlink(path);
    }

    throw error;
  }
}

function writeNewImageFile(
  parentFd: number,
  fileName: string,
  imageBytes: Uint8Array,
  writeFileImpl: (fileDescriptor: number, imageBytes: Uint8Array) => void,
  closeFileImpl: (fileDescriptor: number) => void,
): WriteOutcome {
  const targetPath = procChildPath(parentFd, fileName);

  try {
    writeBytesToPath(
      targetPath,
      imageBytes,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | getNoFollowFlag(),
      writeFileImpl,
      closeFileImpl,
    );

    return {
      commit() {},
      rollback() {
        tryUnlink(targetPath);
      },
    };
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) {
      throw new Error("Refusing to overwrite existing file without overwrite=true.");
    }

    if (hasErrorCode(error, "ELOOP")) {
      throw new Error("output_path must not be a symbolic link.");
    }

    throwSanitizedWriteError(error);
  }
}

function writeReplacementImageFile(
  parentFd: number,
  fileName: string,
  imageBytes: Uint8Array,
  writeFileImpl: (fileDescriptor: number, imageBytes: Uint8Array) => void,
  closeFileImpl: (fileDescriptor: number) => void,
  validateRoot: () => void,
): WriteOutcome {
  const tempName = `.viz-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
  const backupName = `.viz-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.bak`;
  const tempPath = procChildPath(parentFd, tempName);
  const targetPath = procChildPath(parentFd, fileName);
  const backupPath = procChildPath(parentFd, backupName);
  let tempCreated = false;
  let backupCreated = false;
  let replacementInstalled = false;
  let completed = false;

  try {
    writeBytesToPath(
      tempPath,
      imageBytes,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | getNoFollowFlag(),
      writeFileImpl,
      closeFileImpl,
    );
    tempCreated = true;
    validateRoot();

    const targetStats = tryLstat(targetPath);
    if (targetStats) {
      if (targetStats.isSymbolicLink()) {
        throw new Error("output_path must not be a symbolic link.");
      }

      if (!targetStats.isFile()) {
        throw new Error("output_path must be a file path.");
      }

      renameSync(targetPath, backupPath);
      backupCreated = true;
    }

    renameSync(tempPath, targetPath);
    tempCreated = false;
    replacementInstalled = true;
    validateRoot();

    completed = true;
    return {
      commit() {
        if (backupCreated) {
          tryUnlink(backupPath);
          backupCreated = false;
        }
      },
      rollback() {
        if (replacementInstalled) {
          tryUnlink(targetPath);
          replacementInstalled = false;
        }

        if (backupCreated) {
          try {
            renameSync(backupPath, targetPath);
            backupCreated = false;
          } catch {
            // Best-effort restore only.
          }
        }
      },
    };
  } catch (error) {
    throwSanitizedWriteError(error);
  } finally {
    if (!completed && replacementInstalled) {
      tryUnlink(targetPath);
    }

    if (!completed && backupCreated) {
      try {
        renameSync(backupPath, targetPath);
        backupCreated = false;
      } catch {
        // Best-effort restore only; surface the original failure.
      }
    }

    if (!completed && backupCreated) {
      try {
        renameSync(backupPath, targetPath);
      } catch {
        // Best-effort restore only; surface the original failure.
      }
    }

    if (tempCreated) {
      tryUnlink(tempPath);
    }
  }

  throw new Error("Failed to write image output.");
}

function writeImageFileSafely(
  boundOutput: BoundOutputRoot,
  imageBytes: Uint8Array,
  overwrite = false,
  beforeFinalWrite?: () => void,
  afterFinalWrite?: () => void,
  writeFileImpl: (fileDescriptor: number, imageBytes: Uint8Array) => void = writeFileSync,
  closeFileImpl: (fileDescriptor: number) => void = closeSync,
): void {
  assertBoundRootStillCurrent(boundOutput);
  beforeFinalWrite?.();
  assertBoundRootStillCurrent(boundOutput);

  let outcome: WriteOutcome | undefined;

  withBoundParentDirectory(boundOutput, (parentFd, fileName) => {
    assertBoundOutputTargetSafe(parentFd, fileName, overwrite);

    if (overwrite) {
      outcome = writeReplacementImageFile(parentFd, fileName, imageBytes, writeFileImpl, closeFileImpl, () => assertBoundRootStillCurrent(boundOutput));
      return;
    }

    outcome = writeNewImageFile(parentFd, fileName, imageBytes, writeFileImpl, closeFileImpl);
  });

  try {
    afterFinalWrite?.();
    assertBoundRootStillCurrent(boundOutput);
    outcome?.commit();
  } catch (error) {
    outcome?.rollback();
    throw error;
  }
}

export function resolveVizConfig(env: NodeJS.ProcessEnv = process.env, workspaceRoot?: string, currentDirectory?: string): VizConfig {
  const directBaseUrl = resolveDirectEnvConfig(env, "VIZ_OPENAI_BASE_URL", "OPENAI_BASE_URL");
  const directApiKey = resolveDirectEnvConfig(env, "VIZ_OPENAI_API_KEY", "OPENAI_API_KEY");
  const providerConfig = typeof directBaseUrl === "string" && typeof directApiKey === "string"
    ? {}
    : readOpenAIProviderConfig(env, workspaceRoot, currentDirectory);

  return {
    baseUrl: (typeof directBaseUrl === "string" ? directBaseUrl : providerConfig.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    apiKey: directApiKey === null ? undefined : directApiKey || providerConfig.apiKey,
    model: env.VIZ_IMAGE_MODEL || DEFAULT_MODEL,
  };
}

function resolveDirectEnvConfig(env: NodeJS.ProcessEnv, highPriorityName: string, lowPriorityName: string): ResolvedConfigString {
  if (Object.prototype.hasOwnProperty.call(env, highPriorityName)) {
    return normalizeConfigString(env[highPriorityName]);
  }

  if (Object.prototype.hasOwnProperty.call(env, lowPriorityName)) {
    return normalizeConfigString(env[lowPriorityName]);
  }

  return undefined;
}

function normalizeConfigString(value: string | undefined): ResolvedConfigString {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readOpenAIProviderConfig(env: NodeJS.ProcessEnv, workspaceRoot?: string, currentDirectory?: string): OpenAIProviderConfig {
  const providerConfig: OpenAIProviderConfig = {};

  for (const configSource of readOpenCodeConfigSources(env, workspaceRoot, currentDirectory)) {
    try {
      const parsed = JSON.parse(stripJsonTrailingCommas(stripJsonComments(configSource.contents))) as {
        provider?: {
          openai?: {
            options?: {
              apiKey?: unknown;
              baseURL?: unknown;
              baseUrl?: unknown;
            };
          };
        };
      };
      const options = parsed.provider?.openai?.options;
      const apiKey = options && Object.prototype.hasOwnProperty.call(options, "apiKey")
        ? resolveConfigString(options.apiKey, env, configSource.path)
        : undefined;
      const baseUrl = options && Object.prototype.hasOwnProperty.call(options, "baseURL")
        ? resolveConfigString(options.baseURL, env, configSource.path)
        : options && Object.prototype.hasOwnProperty.call(options, "baseUrl")
          ? resolveConfigString(options.baseUrl, env, configSource.path)
          : undefined;

      if (apiKey === null) {
        delete providerConfig.apiKey;
      } else if (apiKey) {
        providerConfig.apiKey = apiKey;
      }

      if (baseUrl === null) {
        delete providerConfig.baseUrl;
      } else if (baseUrl) {
        providerConfig.baseUrl = baseUrl;
      }
    } catch {
      continue;
    }
  }

  return providerConfig;
}

function readOpenCodeConfigSources(env: NodeJS.ProcessEnv, workspaceRoot?: string, currentDirectory?: string): OpenCodeConfigSource[] {
  const sources: OpenCodeConfigSource[] = [];
  const seenPaths = new Set<string>();
  const addConfigFile = (configPath: string | undefined) => {
    if (!configPath) {
      return;
    }

    const resolvedPath = resolve(configPath);
    if (seenPaths.has(resolvedPath)) {
      return;
    }

    seenPaths.add(resolvedPath);

    try {
      sources.push({ contents: readFileSync(resolvedPath, "utf8"), path: resolvedPath });
    } catch {
      // Best-effort fallback only.
    }
  };
  const addConfigDir = (configDir: string | undefined) => {
    if (!configDir) {
      return;
    }

    addConfigFile(join(configDir, "opencode.json"));
    addConfigFile(join(configDir, "opencode.jsonc"));
  };

  const projectConfigDirs = getProjectConfigDirs(workspaceRoot, currentDirectory);

  addConfigDir(DEFAULT_OPENCODE_CONFIG_DIR);
  addConfigFile(env.OPENCODE_CONFIG);
  for (const configDir of projectConfigDirs) {
    addConfigDir(configDir);
    addConfigDir(join(configDir, ".opencode"));
  }
  addConfigDir(env.OPENCODE_CONFIG_DIR);
  addConfigFile(env.VIZ_OPENCODE_CONFIG_FILE);

  if (env.VIZ_OPENCODE_CONFIG_CONTENT || env.OPENCODE_CONFIG_CONTENT) {
    sources.push({ contents: env.OPENCODE_CONFIG_CONTENT || "" });
    sources.push({ contents: env.VIZ_OPENCODE_CONFIG_CONTENT || "" });
  }

  return sources;
}

function getProjectConfigDirs(workspaceRoot?: string, currentDirectory?: string): string[] {
  if (!workspaceRoot) {
    return [];
  }

  const root = resolve(workspaceRoot);
  const current = resolve(currentDirectory || workspaceRoot);
  const relativeCurrent = relative(root, current);
  const dirs = [root];

  if (relativeCurrent && !relativeCurrent.startsWith("..") && !isAbsolute(relativeCurrent)) {
    let nextDir = root;
    for (const part of relativeCurrent.split("/")) {
      if (!part) {
        continue;
      }

      nextDir = join(nextDir, part);
      dirs.push(nextDir);
    }
  }

  return dirs;
}

function rejectUnresolvedPlaceholders(value: string): ResolvedConfigString {
  return value.includes("{") || value.includes("}") ? null : value;
}

function resolveConfigString(value: unknown, env: NodeJS.ProcessEnv, configPath?: string): ResolvedConfigString {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const envMatch = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(trimmed);
  if (envMatch) {
    const envValue = normalizeConfigString(env[envMatch[1]]) ?? null;
    return typeof envValue === "string" ? rejectUnresolvedPlaceholders(envValue) : envValue;
  }

  const fileMatch = /^\{file:(.+)\}$/.exec(trimmed);
  if (fileMatch) {
    try {
      const fileValue = readFileSync(resolveConfigFilePath(fileMatch[1], configPath), "utf8").trim();
      return fileValue ? rejectUnresolvedPlaceholders(fileValue) : null;
    } catch {
      return null;
    }
  }

  return rejectUnresolvedPlaceholders(trimmed);
}

function resolveConfigFilePath(filePath: string, configPath?: string): string {
  if (filePath === "~") {
    return homedir();
  }

  if (filePath.startsWith("~/")) {
    return join(homedir(), filePath.slice(2));
  }

  if (isAbsolute(filePath)) {
    return filePath;
  }

  return configPath ? resolve(dirname(configPath), filePath) : resolve(filePath);
}

function stripJsonComments(contents: string): string {
  let result = "";
  let inString = false;
  let stringQuote = "";
  let escaping = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < contents.length; index++) {
    const char = contents[index];
    const nextChar = contents[index + 1];

    if (inLineComment) {
      if (char === "\n" || char === "\r") {
        inLineComment = false;
        result += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        inBlockComment = false;
        index++;
      }
      continue;
    }

    if (inString) {
      result += char;

      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === stringQuote) {
        inString = false;
        stringQuote = "";
      }

      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringQuote = char;
      result += char;
      continue;
    }

    if (char === "/" && nextChar === "/") {
      inLineComment = true;
      index++;
      continue;
    }

    if (char === "/" && nextChar === "*") {
      inBlockComment = true;
      index++;
      continue;
    }

    result += char;
  }

  return result;
}

function stripJsonTrailingCommas(contents: string): string {
  let result = "";
  let inString = false;
  let stringQuote = "";
  let escaping = false;

  for (let index = 0; index < contents.length; index++) {
    const char = contents[index];

    if (inString) {
      result += char;

      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === stringQuote) {
        inString = false;
        stringQuote = "";
      }

      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringQuote = char;
      result += char;
      continue;
    }

    if (char === ",") {
      let lookaheadIndex = index + 1;
      while (/\s/.test(contents[lookaheadIndex] || "")) {
        lookaheadIndex++;
      }

      if (contents[lookaheadIndex] === "}" || contents[lookaheadIndex] === "]") {
        continue;
      }
    }

    result += char;
  }

  return result;
}

function buildHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function isTransientFailure(status?: number, text?: string, error?: unknown): boolean {
  if (status === 502 || status === 503 || status === 504) {
    return true;
  }

  const haystack = `${text || ""} ${error instanceof Error ? error.message : String(error || "")}`.toLowerCase();
  return haystack.includes("stream_incomplete") || haystack.includes("websocket closed");
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function createImageResponse(
  prompt: string,
  config: VizConfig,
  deps: GenerateImageDependencies = {},
): Promise<ResponsesApiResponse> {
  const fetchImpl = deps.fetchImpl || fetch;
  const sleep = deps.sleep || defaultSleep;
  const url = `${config.baseUrl}${RESPONSE_PATH}`;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: buildHeaders(config.apiKey),
        body: JSON.stringify({
          model: config.model,
          input: prompt,
          tools: [{ type: "image_generation" }],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (attempt < RETRY_DELAYS_MS.length && isTransientFailure(response.status, errorText)) {
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw new Error(`Image generation request failed with HTTP ${response.status}.`);
      }

      const responseText = await response.text();

      try {
        return JSON.parse(responseText) as ResponsesApiResponse;
      } catch {
        if (isTransientFailure(response.status, responseText)) {
          if (attempt < RETRY_DELAYS_MS.length) {
            await sleep(RETRY_DELAYS_MS[attempt]);
            continue;
          }

          throw new Error("Image generation failed after transient response errors.");
        }

        throw new Error("Image generation response was not valid JSON.");
      }
    } catch (error) {
      if (attempt < RETRY_DELAYS_MS.length && isTransientFailure(undefined, undefined, error)) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw error;
    }
  }

  throw new Error("Image generation failed after retries.");
}

function getImageGenerationCall(response: ResponsesApiResponse): ImageGenerationCall {
  if (!Array.isArray(response.output)) {
    throw new Error("Responses API response is missing output[].");
  }

  const imageCall = response.output.find((item) => {
    return item && typeof item === "object" && "type" in item && item.type === "image_generation_call";
  });

  if (!imageCall || typeof imageCall !== "object") {
    throw new Error("Responses API response is missing image_generation_call output.");
  }

  if (!("result" in imageCall) || typeof imageCall.result !== "string" || !imageCall.result.trim()) {
    throw new Error("Responses API image_generation_call is missing result.");
  }

  return {
    result: imageCall.result,
    revised_prompt: "revised_prompt" in imageCall && typeof imageCall.revised_prompt === "string"
      ? imageCall.revised_prompt
      : undefined,
  };
}

export function decodeBase64Image(result: string): Buffer {
  const normalized = result.trim();
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error("Responses API image result is not valid base64.");
  }

  const bytes = Buffer.from(normalized, "base64");
  if (!bytes.length || bytes.toString("base64") !== normalized) {
    throw new Error("Responses API image result is not valid base64.");
  }

  return bytes;
}

export function assertPng(bytes: Uint8Array): void {
  if (bytes.length < PNG_SIGNATURE.length) {
    throw new Error("Generated image is not a PNG.");
  }

  for (let index = 0; index < PNG_SIGNATURE.length; index++) {
    if (bytes[index] !== PNG_SIGNATURE[index]) {
      throw new Error("Generated image is not a PNG.");
    }
  }
}

export async function generateImage(
  ctx: PluginContext,
  args: VizGenerateImageArgs,
  deps: GenerateImageDependencies = {},
): Promise<VizGenerateImageResult> {
  const boundOutput = bindOutputRoot(ctx, args.output_path);

  try {
    preflightBoundOutputPath(boundOutput, args.overwrite);
    const config = resolveVizConfig(deps.env, boundOutput.workspaceRoot, ctx.directory);
    const response = await createImageResponse(args.prompt, config, deps);

    if (typeof response.id !== "string" || !response.id) {
      throw new Error("Responses API response is missing id.");
    }

    const imageCall = getImageGenerationCall(response);
    const imageBytes = decodeBase64Image(imageCall.result);
    assertPng(imageBytes);

    writeImageFileSafely(boundOutput, imageBytes, args.overwrite, deps.beforeFinalWrite, deps.afterFinalWrite, deps.writeFileImpl, deps.closeFileImpl);

    return {
      output_path: boundOutput.outputPath,
      bytes: imageBytes.byteLength,
      model: config.model,
      response_id: response.id,
      revised_prompt: imageCall.revised_prompt,
    };
  } finally {
    closeBoundOutputRoot(boundOutput);
  }
}

export const VizPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      viz_generate_image: tool({
        description: "Generate a PNG image from a prompt and save it in the current worktree.",
        args: {
          prompt: tool.schema.string().describe("Image prompt"),
          output_path: tool.schema.string().describe("PNG output path within the current worktree"),
          overwrite: tool.schema.boolean().optional().describe("Overwrite an existing PNG file when true"),
        },
        async execute(args) {
          return JSON.stringify(await generateImage(ctx, args), null, 2);
        },
      }),
    },
  };
};
