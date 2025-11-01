import { ChatOpenAI } from '@langchain/openai';
import { StructuredTool } from '@langchain/core/tools';
import { HumanMessage, BaseMessage } from '@langchain/core/messages';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { CodeMieConfig } from './config.js';
import { SYSTEM_PROMPT } from './prompts.js';
import type { AgentEventCallback } from './agent-events.js';
import { getErrorMessage } from '../utils/errors.js';

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export class CodeMieAgent {
  private model: ChatOpenAI;
  private tools: StructuredTool[];
  private agent: ReturnType<typeof createReactAgent>;
  private conversationHistory: BaseMessage[] = [];

  constructor(config: CodeMieConfig, tools: StructuredTool[]) {
    this.tools = tools;

    // Initialize AI model for OpenAI-compatible endpoints (LiteLLM proxy, etc.)
    this.model = new ChatOpenAI({
      model: config.model,
      apiKey: config.authToken, // Changed from openAIApiKey to apiKey for LangChain 1.x
      configuration: {
        baseURL: config.baseUrl,
      },
      maxTokens: 4096,
      temperature: 0.7,
      maxRetries: 2,
      timeout: config.timeout * 1000
    });

    // Override the default invocation params to remove top_p
    // This prevents Bedrock errors about both temperature and top_p being set
    const originalInvocationParams = this.model.invocationParams.bind(this.model);
    this.model.invocationParams = function(options?:Record<string,unknown>) {
      const params = originalInvocationParams(options);
      // Remove top_p if present to avoid Bedrock conflicts
      if ('top_p' in params) {
        delete params.top_p;
      }
      return params;
    };

    // Create LangGraph ReAct agent (matches Python implementation)
    this.agent = createReactAgent({
      llm: this.model,
      tools: this.tools,
      messageModifier: SYSTEM_PROMPT
    });
  }

  async chat(userMessage: string): Promise<string> {
    // Add user message to history
    this.conversationHistory.push(new HumanMessage(userMessage));

    // Invoke agent with conversation history
    const result = await this.agent.invoke(
      { messages: this.conversationHistory },
      { recursionLimit: 200 }
    );

    // Extract final response from agent output
    const messages = result.messages || [];
    const lastMessage = messages[messages.length - 1];
    const response = lastMessage?.content || '';

    // Update conversation history with all messages from agent
    this.conversationHistory = messages;

    return response;
  }

  async chatStream(userMessage: string, onEvent: AgentEventCallback, signal?: AbortSignal): Promise<void> {
    // Add user message to history
    this.conversationHistory.push(new HumanMessage(userMessage));

    try {
      onEvent({ type: 'thinking_start' });

      // Stream agent execution
      const stream = await this.agent.stream(
        { messages: this.conversationHistory },
        { streamMode: 'updates', recursionLimit: 200 }
      );

      let currentContent = '';
      let allMessages: BaseMessage[] = [];

      for await (const chunk of stream) {
        // Check if execution was cancelled
        if (signal?.aborted) {
          onEvent({ type: 'cancelled' });
          throw new Error('Execution cancelled by user');
        }
        // LangGraph streams updates by node
        // 'agent' node = model thinking/responding
        // 'tools' node = tool execution

        if (chunk.agent) {
          // Agent node update
          const messages = chunk.agent.messages || [];

          for (const msg of messages) {
            if (msg.content && typeof msg.content === 'string') {
              // Stream content chunk
              const newContent = msg.content.slice(currentContent.length);
              if (newContent) {
                currentContent = msg.content;
                onEvent({ type: 'content_chunk', content: newContent });
              }
            }

            // Check for tool calls
            if (msg.tool_calls && msg.tool_calls.length > 0) {
              for (const toolCall of msg.tool_calls) {
                onEvent({
                  type: 'tool_call_start',
                  toolName: toolCall.name,
                  toolArgs: toolCall.args
                });
              }
            }

            allMessages.push(msg);
          }
        }

        if (chunk.tools) {
          // Tool execution results
          const messages = chunk.tools.messages || [];

          for (const msg of messages) {
            // Tool message contains the result
            if (msg.content) {
              const toolName = (msg as Record<string, unknown>).name as string || 'unknown';
              onEvent({
                type: 'tool_call_result',
                toolName: toolName,
                result: msg.content
              });
            }

            allMessages.push(msg);
          }
        }
      }

      onEvent({ type: 'thinking_end' });

      // Update conversation history
      this.conversationHistory = allMessages.length > 0 ? allMessages : this.conversationHistory;

      onEvent({ type: 'complete' });

    } catch (error: unknown) {
      // Don't emit error event for cancellations - already handled by 'cancelled' event
      const errorMsg = getErrorMessage(error);
      if (errorMsg !== 'Execution cancelled by user') {
        onEvent({ type: 'error', error: errorMsg });
      }
      throw error; // Re-throw original error without wrapping
    }
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  getHistory(): AgentMessage[] {
    return this.conversationHistory.map(msg => ({
      role: msg._getType() === 'human' ? 'user' : 'assistant',
      content: msg.content as string
    }));
  }
}
