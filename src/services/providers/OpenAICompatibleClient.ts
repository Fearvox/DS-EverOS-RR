import OpenAI from "openai";
import type { LLMProvider, LLMResponse, ProviderConfig, ToolCallInfo } from "./types.js";

export class OpenAICompatibleClient implements LLMProvider {
  readonly name: string;
  readonly modelName: string;
  private client: OpenAI;
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.name = config.name;
    this.modelName = config.modelName;
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: 180_000,
    });
  }

  async createMessage(params: {
    systemPrompt: string;
    messages: Array<{ role: string; content: unknown }>;
    tools?: unknown[];
  }): Promise<LLMResponse> {
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: params.systemPrompt },
      ...(params.messages as OpenAI.ChatCompletionMessageParam[]),
    ];

    const response = await this.client.chat.completions.create({
      model: this.modelName,
      messages,
      temperature: this.config.temperature ?? 1.0,
      max_completion_tokens: this.config.maxTokens ?? 32000,
      stream: false,
    });

    const choice = response.choices[0];
    const toolCalls: ToolCallInfo[] = (choice.message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));

    return {
      text: choice.message.content ?? "",
      finishReason: choice.finish_reason ?? "stop",
      toolCalls,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      raw: response,
    };
  }
}
