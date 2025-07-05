import { EventEmitter } from 'events';
import type { ConfigManager } from './configManager';
import type { Logger } from '../utils/logger';
import type { SessionManager } from './sessionManager'; // Assuming SessionManager is the type for sessionManager
import { ClaudeCodeManager } from './claudeCodeManager';
import { OllamaManager } from './ollamaManager';

// Define a common interface for provider operations (simplified for now)
interface LLMProvider {
  startSession(sessionId: string, worktreePath: string, prompt: string, agentId?: string, permissionMode?: 'approve' | 'ignore'): Promise<void>;
  continueSession(sessionId: string, worktreePath: string, prompt: string, conversationHistory: any[], agentId?: string): Promise<void>;
  stopSession(sessionId: string): Promise<void>;
  sendInput?(sessionId: string, input: string): void; // Optional, Claude specific for now
  isSessionRunning(sessionId: string): boolean;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  emit(event: string | symbol, ...args: any[]): boolean;
  clearAvailabilityCache?(): void; // For Claude
}

export class AgentHostManager extends EventEmitter implements LLMProvider {
  private configManager: ConfigManager;
  private logger?: Logger;
  private sessionManager: any; // Use actual type if available
  private claudeManager: ClaudeCodeManager;
  private ollamaManager: OllamaManager;
  private permissionIpcPath?: string | null;

  // To keep track of which provider is used for which session
  private sessionProviders: Map<string, LLMProvider> = new Map();

  constructor(
    configManager: ConfigManager,
    sessionManager: any, // Use SessionManager type
    logger?: Logger,
    permissionIpcPath?: string | null
  ) {
    super();
    this.configManager = configManager;
    this.sessionManager = sessionManager;
    this.logger = logger;
    this.permissionIpcPath = permissionIpcPath;

    this.claudeManager = new ClaudeCodeManager(this.sessionManager, this.logger, this.configManager, this.permissionIpcPath);
    this.ollamaManager = new OllamaManager(this.configManager, this.logger);

    // Forward events from underlying managers
    this.claudeManager.on('output', (data) => this.emit('output', data));
    this.claudeManager.on('exit', (data) => {
      this.sessionProviders.delete(data.sessionId);
      this.emit('exit', data);
    });
    this.claudeManager.on('error', (data) => this.emit('error', data));
    this.claudeManager.on('spawned', (data) => this.emit('spawned', data));

    this.ollamaManager.on('output', (data) => this.emit('output', data));
    this.ollamaManager.on('exit', (data) => {
      this.sessionProviders.delete(data.sessionId);
      this.emit('exit', data);
    });
    this.ollamaManager.on('error', (data) => this.emit('error', data));
    this.ollamaManager.on('spawned', (data) => this.emit('spawned', data));

    this.setMaxListeners(100); // Increase listener limit
  }

  private getProviderForSession(sessionId: string, agentId?: string): LLMProvider {
    const config = this.configManager.getConfig();
    let providerType = config.defaultProvider || 'claude'; // Default to Claude

    // Check for agent-specific provider
    if (agentId && config.agents && config.agents[agentId]?.provider) {
      providerType = config.agents[agentId]!.provider!;
    }

    this.logger?.info(`[AgentHostManager] Session ${sessionId} (Agent: ${agentId || 'default'}) will use provider: ${providerType}`);

    if (providerType === 'ollama') {
      return this.ollamaManager;
    }
    return this.claudeManager;
  }

  async startSession(sessionId: string, worktreePath: string, prompt: string, agentId?: string, permissionMode?: 'approve' | 'ignore'): Promise<void> {
    const provider = this.getProviderForSession(sessionId, agentId);
    this.sessionProviders.set(sessionId, provider);

    if (provider === this.ollamaManager) {
      // OllamaManager's generateResponse is its "start"
      // It doesn't use worktreePath or permissionMode in the same way Claude CLI does.
      // We might need to adjust how these are handled or passed.
      return this.ollamaManager.generateResponse(sessionId, prompt, agentId);
    } else {
      // ClaudeCodeManager needs permissionMode
      return this.claudeManager.startSession(sessionId, worktreePath, prompt, permissionMode);
    }
  }

  async continueSession(sessionId: string, worktreePath: string, prompt: string, conversationHistory: any[], agentId?: string): Promise<void> {
    // Determine if the session was originally started with a specific provider
    let provider = this.sessionProviders.get(sessionId);
    if (!provider) {
        this.logger?.warn(`[AgentHostManager] No provider found for existing session ${sessionId}, determining based on current config.`);
        provider = this.getProviderForSession(sessionId, agentId);
        this.sessionProviders.set(sessionId, provider);
    } else {
        this.logger?.info(`[AgentHostManager] Continuing session ${sessionId} with its original provider.`);
    }


    if (provider === this.ollamaManager) {
      // OllamaManager's generateResponse can take conversationHistory
      return this.ollamaManager.generateResponse(sessionId, prompt, agentId, conversationHistory);
    } else {
      // ClaudeCodeManager's continueSession implies using its internal history management via --continue
      // The `conversationHistory` param might be redundant here if Claude manages it internally.
      // The current ClaudeCodeManager `continueSession` takes `conversationHistory` but it's not directly used with `--continue` flag.
      // For now, we pass it along.
      return this.claudeManager.continueSession(sessionId, worktreePath, prompt, conversationHistory);
    }
  }

  async stopSession(sessionId: string): Promise<void> {
    const provider = this.sessionProviders.get(sessionId);
    if (provider) {
      await provider.stopSession(sessionId);
      this.sessionProviders.delete(sessionId);
    } else {
      this.logger?.warn(`[AgentHostManager] stopSession called for ${sessionId} but no active provider found. Attempting to stop both.`);
      // If we don't know, try stopping both as a fallback, though this isn't ideal.
      await this.claudeManager.stopSession(sessionId);
      await this.ollamaManager.stopSession(sessionId);
    }
  }

  sendInput(sessionId: string, input: string): void {
    const provider = this.sessionProviders.get(sessionId);
    if (provider === this.claudeManager && provider.sendInput) {
      provider.sendInput(sessionId, input);
    } else if (provider === this.ollamaManager) {
      this.logger?.warn(`[AgentHostManager] sendInput called for Ollama session ${sessionId}, which is not supported. Input: ${input}`);
      // Ollama doesn't have an interactive input stream like Claude CLI's PTY
      // This might need a different UX/flow for Ollama.
    } else {
         this.logger?.warn(`[AgentHostManager] sendInput called for ${sessionId} but no active or compatible provider found.`);
    }
  }

  isSessionRunning(sessionId: string): boolean {
    const provider = this.sessionProviders.get(sessionId);
    return provider ? provider.isSessionRunning(sessionId) : false;
  }

  clearAvailabilityCache(): void {
    // This is specific to Claude's CLI check
    this.claudeManager.clearAvailabilityCache?.();
  }

  // This method is to allow other parts of the application (e.g. settings change handler)
  // to notify relevant managers about config changes.
  handleConfigUpdate(): void {
    this.logger?.info("[AgentHostManager] Configuration updated. Clearing Claude availability cache.");
    this.claudeManager.clearAvailabilityCache?.();
    // OllamaManager doesn't have a cache to clear in the current implementation,
    // but if it did, we'd call it here.
  }

  async shutdown(): Promise<void> {
    this.logger?.info('[AgentHostManager] Shutting down all providers...');
    // Claude specific cleanup
    await this.claudeManager.killAllProcesses();
    this.logger?.info('[AgentHostManager] Claude processes killed.');

    // Ollama specific cleanup (if any needed in the future, e.g., aborting active requests)
    // For now, OllamaManager's stopSession is per-session and there's no global "process" to kill.
    // We could iterate over this.sessionProviders and call stopSession if truly needed,
    // but sessionManager.cleanup should handle that for active sessions.
    // killAllProcesses for Claude is more about any lingering CLI instances.

    this.logger?.info('[AgentHostManager] All providers shut down.');
  }
}
