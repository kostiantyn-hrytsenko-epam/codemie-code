// Event types for agent-to-UI communication during streaming

export type AgentEventType =
  | 'content_chunk'      // Text content chunk
  | 'tool_call_start'    // Tool call started
  | 'tool_call_result'   // Tool call completed
  | 'tool_call_error'    // Tool call failed
  | 'thinking_start'     // Model is thinking
  | 'thinking_end'       // Model finished thinking
  | 'error'              // Error occurred
  | 'cancelled'          // Execution cancelled by user
  | 'complete';          // Response complete

export interface ContentChunkEvent {
  type: 'content_chunk';
  content: string;
}

export interface ToolCallStartEvent {
  type: 'tool_call_start';
  toolName: string;
  toolArgs: Record<string, unknown>;
}

export interface ToolCallResultEvent {
  type: 'tool_call_result';
  toolName: string;
  result: string;
}

export interface ToolCallErrorEvent {
  type: 'tool_call_error';
  toolName: string;
  error: string;
}

export interface ThinkingStartEvent {
  type: 'thinking_start';
}

export interface ThinkingEndEvent {
  type: 'thinking_end';
}

export interface ErrorEvent {
  type: 'error';
  error: string;
}

export interface CompleteEvent {
  type: 'complete';
}

export interface CancelledEvent {
  type: 'cancelled';
}

export type AgentEvent =
  | ContentChunkEvent
  | ToolCallStartEvent
  | ToolCallResultEvent
  | ToolCallErrorEvent
  | ThinkingStartEvent
  | ThinkingEndEvent
  | ErrorEvent
  | CancelledEvent
  | CompleteEvent;

export type AgentEventCallback = (event: AgentEvent) => void;
