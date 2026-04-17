export interface ProviderConfig {
  name: string;
  providerClass: "anthropic" | "openai-compatible" | "bedrock" | "vertex";
  modelName: string;
  apiKey: string;
  baseUrl: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  maxContextLength?: number;
  reasoningEffort?: string | null;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  text: string;
  finishReason: string;
  toolCalls: ToolCallInfo[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  raw: unknown;
}

export interface LLMProvider {
  readonly name: string;
  readonly modelName: string;

  createMessage(params: {
    systemPrompt: string;
    messages: Array<{ role: string; content: unknown }>;
    tools?: unknown[];
  }): Promise<LLMResponse>;
}

export interface ProviderRouterConfig {
  providers: ProviderConfig[];
  defaultProvider: string;
  fallbackChain?: string[];
}
