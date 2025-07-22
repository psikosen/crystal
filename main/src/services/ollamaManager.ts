import { EventEmitter } from 'events';
import type { ConfigManager } from './configManager';
import type { Logger } from '../utils/logger';
import fetch from 'node-fetch'; // We'll need to install this

// Define interfaces for Ollama API request and response (simplified)
interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream?: boolean;
  history?: any[]; // Define a proper type for history later
}

interface OllamaGenerateResponseChunk {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[]; // Context for follow-up requests
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export class OllamaManager extends EventEmitter {
  private configManager: ConfigManager;
  private logger?: Logger;

  constructor(configManager: ConfigManager, logger?: Logger) {
    super();
    this.configManager = configManager;
    this.logger = logger;
    this.setMaxListeners(50); // Similar to ClaudeCodeManager
  }

  async generateResponse(
    sessionId: string, // To associate logs and events
    prompt: string,
    agentId?: string, // To fetch agent-specific model
    conversationHistory?: any[] // Define a proper type later
  ): Promise<void> {
    const config = this.configManager.getConfig();
    const ollamaConfig = config.ollamaConfig || {};
    const apiUrl = ollamaConfig.apiUrl || 'http://localhost:11434'; // Default if not set

    let model: string | undefined;
    if (agentId && config.agents && config.agents[agentId]?.provider === 'ollama') {
      model = config.agents[agentId]?.model;
    }
    model = model || ollamaConfig.defaultModel;

    if (!model) {
      const errorMsg = 'Ollama model not configured. Please set a default Ollama model or specify one for the agent.';
      this.logger?.error(`[OllamaManager] ${errorMsg}`);
      this.emit('output', {
        sessionId,
        type: 'json', // Emit as JSON error similar to ClaudeCodeManager
        data: { type: 'session', data: { status: 'error', message: errorMsg } },
        timestamp: new Date(),
      });
      this.emit('exit', { sessionId, exitCode: 1, signal: null });
      return;
    }

    const endpoint = `${apiUrl.replace(/\/$/, '')}/api/generate`;
    this.logger?.verbose(`[OllamaManager] Sending request to Ollama: ${endpoint} with model ${model}`);

    const payload: OllamaGenerateRequest = {
      model,
      prompt,
      stream: true, // We want streaming for real-time output
      history: conversationHistory,
    };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        const errorMsg = `Ollama API request failed: ${response.status} ${response.statusText} - ${errorBody}`;
        this.logger?.error(`[OllamaManager] ${errorMsg}`);
        this.emit('output', {
          sessionId,
          type: 'json',
          data: { type: 'session', data: { status: 'error', message: 'Ollama API Error', details: errorMsg } },
          timestamp: new Date(),
        });
        this.emit('exit', { sessionId, exitCode: 1, signal: null });
        return;
      }

      if (!response.body) {
        const errorMsg = 'Ollama API response body is null.';
        this.logger?.error(`[OllamaManager] ${errorMsg}`);
        this.emit('output', {
          sessionId,
          type: 'json',
          data: { type: 'session', data: { status: 'error', message: errorMsg } },
          timestamp: new Date(),
        });
        this.emit('exit', { sessionId, exitCode: 1, signal: null });
        return;
      }

      // Process the streaming response
      // Each chunk is a JSON object on a new line
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      this.emit('spawned', { sessionId }); // Indicate that the "process" has started

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim()) {
            try {
              const chunk = JSON.parse(line.trim()) as OllamaGenerateResponseChunk;
              this.logger?.verbose(`[OllamaManager] Received chunk for session ${sessionId}: ${chunk.response}`);
              // Emit the content of the 'response' field, which is the generated text
              this.emit('output', {
                sessionId,
                type: 'json', // Emitting as JSON, similar to Claude
                // We need to adapt this to the expected JSON structure for 'output' events
                // For now, let's simulate a thinking/progress update
                data: { type: 'tool_code', data: chunk.response }, // This might need adjustment
                timestamp: new Date(),
              });

              if (chunk.done) {
                this.logger?.info(`[OllamaManager] Ollama generation complete for session ${sessionId}`);
                this.emit('output', { // Send a final message indicating completion if necessary
                    sessionId,
                    type: 'json',
                    data: { type: 'session', data: { status: 'complete', message: 'Ollama generation finished.'} },
                    timestamp: new Date()
                });
                this.emit('exit', { sessionId, exitCode: 0, signal: null });
                return; // Generation is complete
              }
            } catch (error) {
              this.logger?.error(`[OllamaManager] Error parsing Ollama response chunk for session ${sessionId}: ${error} - Chunk: "${line}"`);
              // Emit as raw output if parsing fails
              this.emit('output', {
                sessionId,
                type: 'stderr',
                data: `Error parsing Ollama stream: ${line}\\n`,
                timestamp: new Date(),
              });
            }
          }
        }
      }
      // If the loop finishes without chunk.done being true (e.g. stream ends abruptly)
      this.logger?.info(`[OllamaManager] Ollama stream ended for session ${sessionId}`);
      this.emit('exit', { sessionId, exitCode: 0, signal: null });

    } catch (error: any) {
      const errorMsg = `Error during Ollama request for session ${sessionId}: ${error.message}`;
      this.logger?.error(`[OllamaManager] ${errorMsg}`, error);
      this.emit('output', {
        sessionId,
        type: 'json',
        data: { type: 'session', data: { status: 'error', message: 'Ollama Request Error', details: errorMsg } },
        timestamp: new Date(),
      });
      this.emit('error', { sessionId, error: errorMsg }); // General error event
      this.emit('exit', { sessionId, exitCode: 1, signal: null });
    }
  }

  // We might need methods to kill/stop a request if Ollama supports it,
  // but for now, HTTP requests are harder to "kill" like a PTY process.
  // This will be a simplification compared to ClaudeCodeManager.
  async stopSession(sessionId: string): Promise<void> {
    this.logger?.info(`[OllamaManager] Stop requested for session ${sessionId}. HTTP requests cannot be directly killed once sent. If a stream is active, it will stop processing.`);
    // For now, this is a no-op as we can't easily cancel fetch requests that are in progress.
    // We could implement AbortController if we manage active requests.
    // Emitting 'exit' to signal the session has "stopped" from the manager's perspective.
    this.emit('exit', { sessionId, exitCode: 0, signal: 'SIGTERM' }); // Simulate a stop
  }

  isSessionRunning(sessionId: string): boolean {
    // This is trickier for HTTP requests. We might need to track active streams.
    // For now, let's assume a session is "running" if we haven't emitted 'exit' for it.
    // This will need a more robust implementation if we need to track active requests.
    this.logger?.warn(`[OllamaManager] isSessionRunning for ${sessionId} is a simplified check.`);
    return false; // Placeholder
  }
}
