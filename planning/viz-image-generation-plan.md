# Viz Image Generation Plan

## Goal

Add a first usable `viz_generate_image` tool to `packages/viz` that generates a PNG image from a prompt through the local OpenAI-compatible Codex/load-balancer surface.

## Confirmed Local Surface

Working endpoint:

```http
POST http://127.0.0.1:2455/v1/responses
Authorization: Bearer <localhost key>
```

Working request shape:

```json
{
  "model": "gpt-5.5",
  "input": "Generate an image: ...",
  "tools": [{ "type": "image_generation" }]
}
```

Observed response shape:

- `response.output[]` contains an item with `type: "image_generation_call"`
- the generated image is in `result` as base64
- `revised_prompt` is available on the image generation call

Unstable or failed request shape:

- explicit `tool_choice`
- explicit `action`
- explicit `size`
- explicit `quality`
- explicit `format`

The first implementation should therefore use the simple documented Responses API image-generation shape by default.

## Proposed Tool

Add `viz_generate_image` to `packages/viz/src/plugin.ts`.

Arguments:

```ts
{
  prompt: string;
  output_path: string;
  overwrite?: boolean; // default: false
}
```

Keep the model-callable API prompt-first. Do not expose model, endpoint, API key, style, format, quality, size, or retry settings as tool arguments in the first slice.

Do not accept an API key or base URL as tool arguments. Tool arguments can enter chat/tool logs, and endpoint overrides would create avoidable egress risk. Use environment/config lookup instead.

## Configuration Lookup

Base URL priority:

```text
VIZ_OPENAI_BASE_URL
OPENAI_BASE_URL
http://127.0.0.1:2455/v1
```

API key priority:

```text
VIZ_OPENAI_API_KEY
OPENAI_API_KEY
```

Model priority:

```text
VIZ_IMAGE_MODEL
gpt-5.5
```

These are trusted process-level settings only, not model-callable tool arguments. The local key can remain configured outside the repo. Do not commit it.

Use a fixed internal retry policy in code. Do not expose retry controls on the first public tool surface.

## Format Scope

The first slice is PNG-only.

- Require `output_path` to end in `.png`.
- Decode the returned base64 and validate that the resulting bytes have a PNG signature before writing.
- If the local surface later supports stable format options, add formats as a separate follow-up.

## Output Safety

- Resolve `output_path` relative to `context.worktree` unless absolute paths are explicitly allowed later.
- Reject paths outside the worktree for the first slice.
- Require `output_path` to be a simple filename in the worktree root; nested directories are deferred to avoid unnecessary path-traversal and race surface for the first slice.
- Require `.png` output.
- Refuse to overwrite an existing file unless `overwrite: true`.
- Write binary image bytes decoded from base64.

## Retry Behavior

Retry transient load-balancer failures such as:

- HTTP `502`
- HTTP `503`
- HTTP `504`
- response text containing `stream_incomplete`
- response text containing `websocket closed`

Default internal retries: `2`.

Use short exponential backoff, for example 500ms then 1500ms.

## Tool Return

Return a concise JSON-like summary:

```json
{
  "output_path": "...",
  "bytes": 755154,
  "model": "gpt-5.5",
  "response_id": "resp_...",
  "revised_prompt": "..."
}
```

Never print base64 image data.

## Non-Goals For First Slice

- No image editing.
- No streaming partial image support.
- No deterministic chart/table generation.
- No API key argument.
- No base URL argument.
- No model argument.
- No style argument.
- No retry argument.
- No non-PNG output.
- No direct dependence on OpenCode internal provider/OAuth APIs unless a documented plugin surface is found later.
- No attempt to force `tool_choice`, `size`, `quality`, or `format` until the local surface proves stable with those options.

## Future Slices

1. Add `viz_edit_image` using image input references.
2. Add optional advanced image options with graceful fallback.
3. Add deterministic chart rendering for data accuracy.
4. Add deterministic diagram rendering with Mermaid/Graphviz.
5. Add a small `viz_image_capabilities` probe tool.
6. Investigate whether OpenCode exposes a safe provider-client surface for subscription-backed plugin calls without separate env auth.

## Verification Plan

1. Add focused unit tests for the image-generation helper behavior with mocked `fetch`:
   - outside-worktree path rejection
   - nested path rejection
   - non-`.png` path rejection
   - overwrite refusal
   - symlink target rejection
   - hard-link-safe overwrite behavior
   - worktree root replacement rejection
   - malformed response handling when `image_generation_call` is missing
   - malformed response handling when `result` is missing or invalid base64
   - PNG signature validation before writing
   - sanitized upstream error handling without base64/body leakage
   - internal retry behavior for HTTP `502`, `503`, `504`, and transient marker bodies
2. Run the focused test file, for example `bun test packages/viz/src/plugin.test.ts`.
3. Typecheck the plugin source with an explicit file-scoped command because the root `tsconfig.json` currently excludes `packages/viz/src`, for example:

   ```bash
   bunx tsc --noEmit --strict --module ESNext --moduleResolution bundler --target ESNext --types bun-types --lib ESNext packages/viz/src/plugin.ts packages/viz/src/plugin.test.ts
   ```

4. Run a local generation smoke test against `http://127.0.0.1:2455/v1` as secondary/manual proof.
5. Confirm the image file exists, has non-zero bytes, and starts with a PNG signature.
6. Confirm no key or base64 image data appears in tool output.
