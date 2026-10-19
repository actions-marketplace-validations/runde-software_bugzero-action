import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { NormalizedUsage, Provider } from "./cost";

// A provider-neutral view of one model turn. The agent loop only ever sees these
// shapes; each adapter owns its SDK client + conversation state and translates.

export type ToolCall = { id: string; name: string; input: Record<string, unknown> };
export type ToolResultInput = { id: string; content: string; isError: boolean };

export type ModelTurn = {
  text: string;
  toolCalls: ToolCall[];
  done: boolean; // model stopped without requesting tools
  // Set when the turn can't be continued (output limit, refusal, incomplete
  // response) — the loop then ends the run as failed with this reason.
  failure?: string;
  usage: NormalizedUsage;
};

export interface LlmAdapter {
  // `signal` aborts the call when the run's time budget is used up.
  next(signal: AbortSignal): Promise<ModelTurn>;
  submitToolResults(results: ToolResultInput[]): void;
}

export type AdapterOptions = {
  apiKey: string;
  model: string;
  effort: string;
  system: string;
  userMessage: string;
  tools: Anthropic.Tool[]; // canonical schema
  cacheKey: string; // stable per run — keeps OpenAI requests on the same prompt cache
};

// Room for (adaptive) thinking plus large tool calls — create_pull_request carries
// whole files. Both adapters stream, so a large limit doesn't trip SDK timeouts.
const MAX_OUTPUT_TOKENS = 64_000;

// Effort is passed through as-is: the bugzero app validates it per model, so a new
// effort level needs no action release. Empty = the model's default effort.
type AnthropicEffort = NonNullable<Anthropic.OutputConfig["effort"]>;

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

// The SDKs already retry failed requests; this also covers errors that arrive
// mid-stream (e.g. "overloaded"). Safe because history is only appended after a
// complete response.
function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status && [408, 409, 429, 500, 502, 503, 504, 529].includes(status)) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /overloaded|rate.?limit|ECONNRESET|socket hang up/i.test(message);
}

async function withRetries<T>(call: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (err) {
      if (signal.aborted || attempt >= 2 || !isRetryable(err)) throw err;
      await sleep(3000 * (attempt + 1), signal);
    }
  }
}

// ── Anthropic ──

class AnthropicAdapter implements LlmAdapter {
  private client: Anthropic;
  private model: string;
  private effort: AnthropicEffort | null;
  private system: Anthropic.TextBlockParam[];
  private tools: Anthropic.Tool[];
  private messages: Anthropic.MessageParam[];
  private lastCached: Anthropic.ToolResultBlockParam | null = null;

  constructor(o: AdapterOptions) {
    this.client = new Anthropic({ apiKey: o.apiKey });
    this.model = o.model;
    this.effort = o.effort ? (o.effort as AnthropicEffort) : null;
    this.system = [
      { type: "text", text: o.system, cache_control: { type: "ephemeral" } },
    ];
    this.tools = o.tools;
    this.messages = [{ role: "user", content: o.userMessage }];
  }

  async next(signal: AbortSignal): Promise<ModelTurn> {
    // No `thinking` param: current Claude models think adaptively by default (and
    // reject "disabled"); effort steers how much.
    const params: Anthropic.MessageStreamParams = {
      model: this.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: this.system,
      tools: this.tools,
      messages: this.messages,
      ...(this.effort ? { output_config: { effort: this.effort } } : {}),
    };

    const res = await withRetries(
      () => this.client.messages.stream(params, { signal }).finalMessage(),
      signal,
    );
    // Echo content back verbatim (thinking blocks + signatures must round-trip).
    this.messages.push({ role: "assistant", content: res.content });

    let text = "";
    const toolCalls: ToolCall[] = [];
    for (const block of res.content) {
      if (block.type === "text") text += block.text + "\n";
      else if (block.type === "tool_use")
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        });
    }
    const usage: NormalizedUsage = {
      inputFull: res.usage.input_tokens ?? 0,
      cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
      cacheRead: res.usage.cache_read_input_tokens ?? 0,
      output: res.usage.output_tokens ?? 0,
    };

    // A cut-off response may hold a truncated tool call — never run it.
    if (res.stop_reason === "max_tokens") {
      return {
        text,
        toolCalls: [],
        done: true,
        failure: "The model ran out of output tokens in the middle of a step.",
        usage,
      };
    }
    if (res.stop_reason === "refusal") {
      return {
        text,
        toolCalls: [],
        done: true,
        failure: "The model declined to continue this task.",
        usage,
      };
    }
    return { text, toolCalls, done: res.stop_reason !== "tool_use", usage };
  }

  submitToolResults(results: ToolResultInput[]): void {
    const blocks: Anthropic.ToolResultBlockParam[] = results.map((r) => ({
      type: "tool_result",
      tool_use_id: r.id,
      content: r.content,
      is_error: r.isError,
    }));
    // Slide the single conversation cache breakpoint onto the newest tool result.
    if (this.lastCached) delete this.lastCached.cache_control;
    const tail = blocks[blocks.length - 1];
    if (tail) {
      tail.cache_control = { type: "ephemeral" };
      this.lastCached = tail;
    }
    this.messages.push({ role: "user", content: blocks });
  }
}

// ── OpenAI (Responses API) ──
// Current GPT models only call tools through the Responses API. The conversation is
// kept as a running input list: every output item (reasoning included) is sent back
// unchanged, in order, followed by our function_call_output items. store:false keeps
// nothing on the customer's OpenAI account; encrypted reasoning carries the state.

type ResponsesInput = OpenAI.Responses.ResponseInputItem[];

class OpenAIAdapter implements LlmAdapter {
  private client: OpenAI;
  private model: string;
  private effort: string | null;
  private system: string;
  private cacheKey: string;
  private tools: OpenAI.Responses.FunctionTool[];
  private input: ResponsesInput;

  constructor(o: AdapterOptions) {
    this.client = new OpenAI({ apiKey: o.apiKey });
    this.model = o.model;
    this.effort = o.effort || null;
    this.system = o.system;
    this.cacheKey = o.cacheKey;
    this.tools = o.tools.map((t) => ({
      type: "function",
      name: t.name,
      description: t.description ?? null,
      parameters: t.input_schema as Record<string, unknown>,
      // Our schemas have optional fields; strict mode would require all of them.
      strict: false,
    }));
    this.input = [{ role: "user", content: o.userMessage }];
  }

  async next(signal: AbortSignal): Promise<ModelTurn> {
    const res = await withRetries(
      () =>
        this.client.responses
          .stream(
            {
              model: this.model,
              instructions: this.system,
              input: this.input,
              tools: this.tools,
              // The SDK's types predate efforts like "max"; the API accepts them.
              ...(this.effort
                ? { reasoning: { effort: this.effort as OpenAI.ReasoningEffort } }
                : {}),
              max_output_tokens: MAX_OUTPUT_TOKENS,
              store: false,
              include: ["reasoning.encrypted_content"],
              prompt_cache_key: this.cacheKey,
            },
            { signal },
          )
          .finalResponse(),
      signal,
    );

    this.input.push(...(res.output as unknown as ResponsesInput));

    let text = "";
    const toolCalls: ToolCall[] = [];
    for (const item of res.output) {
      if (item.type === "message") {
        for (const part of item.content) {
          if (part.type === "output_text") text += part.text + "\n";
        }
      } else if (item.type === "function_call") {
        toolCalls.push({
          id: item.call_id,
          name: item.name,
          input: safeJson(item.arguments),
        });
      }
    }

    // input_tokens includes cached tokens (unlike Anthropic) — split them out so
    // they aren't priced twice. cache_write_tokens is newer than the SDK's types.
    const details = res.usage?.input_tokens_details as
      | { cached_tokens?: number; cache_write_tokens?: number }
      | undefined;
    const cacheRead = details?.cached_tokens ?? 0;
    const cacheWrite = details?.cache_write_tokens ?? 0;
    const usage: NormalizedUsage = {
      inputFull: Math.max(0, (res.usage?.input_tokens ?? 0) - cacheRead - cacheWrite),
      cacheWrite,
      cacheRead,
      output: res.usage?.output_tokens ?? 0,
    };

    if (res.status === "incomplete") {
      const reason = res.incomplete_details?.reason;
      return {
        text,
        toolCalls: [],
        done: true,
        failure:
          reason === "max_output_tokens"
            ? "The model ran out of output tokens in the middle of a step."
            : `The model stopped early (${reason ?? "incomplete response"}).`,
        usage,
      };
    }
    return { text, toolCalls, done: toolCalls.length === 0, usage };
  }

  submitToolResults(results: ToolResultInput[]): void {
    for (const r of results) {
      this.input.push({
        type: "function_call_output",
        call_id: r.id,
        // Function outputs have no error flag — say so in the text.
        output: r.isError ? `Error: ${r.content}` : r.content,
      });
    }
  }
}

export function createAdapter(
  provider: Provider,
  opts: AdapterOptions,
): LlmAdapter {
  return provider === "openai"
    ? new OpenAIAdapter(opts)
    : new AnthropicAdapter(opts);
}
