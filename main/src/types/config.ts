export interface ClaudeConfig {
  executablePath?: string;
}

export interface OllamaConfig {
  apiUrl?: string;
  defaultModel?: string;
}

export interface AgentConfig {
  provider?: 'claude' | 'ollama';
  model?: string;
}

export interface AppConfig {
  verbose?: boolean;
  anthropicApiKey?: string;
  // Legacy fields for backward compatibility
  gitRepoPath?: string;
  systemPromptAppend?: string;
  runScript?: string[];
  // Configuration for Claude
  claudeConfig?: ClaudeConfig;
  // Configuration for Ollama
  ollamaConfig?: OllamaConfig;
  // Default LLM provider
  defaultProvider?: 'claude' | 'ollama';
  // Per-agent configuration
  agents?: Record<string, AgentConfig>;
  // Permission mode for all sessions
  defaultPermissionMode?: 'approve' | 'ignore';
  // Auto-check for updates
  autoCheckUpdates?: boolean;
  // Stravu MCP integration
  stravuApiKey?: string;
  stravuServerUrl?: string;
  // Theme preference
  theme?: 'light' | 'dark';
}

export interface UpdateConfigRequest {
  verbose?: boolean;
  anthropicApiKey?: string;
  claudeConfig?: ClaudeConfig;
  ollamaConfig?: OllamaConfig;
  defaultProvider?: 'claude' | 'ollama';
  agents?: Record<string, AgentConfig>;
  systemPromptAppend?: string;
  defaultPermissionMode?: 'approve' | 'ignore';
  autoCheckUpdates?: boolean;
  stravuApiKey?: string;
  stravuServerUrl?: string;
  theme?: 'light' | 'dark';
}