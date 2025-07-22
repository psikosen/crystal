export interface ClaudeConfig {
  executablePath?: string;
}

export interface OllamaConfig {
  apiUrl?: string;
  defaultModel?: string;
}

export interface GeminiConfig {
  defaultModel?: string;
}

export interface AgentConfig {
  provider?: 'claude' | 'ollama' | 'gemini';
  model?: string;
}

export interface AppConfig {
  verbose?: boolean;
  anthropicApiKey?: string;
  geminiApiKey?: string;
  // Legacy fields for backward compatibility
  gitRepoPath?: string;
  systemPromptAppend?: string;
  runScript?: string[];
  // Configuration for Claude
  claudeConfig?: ClaudeConfig;
  // Configuration for Ollama
  ollamaConfig?: OllamaConfig;
  // Configuration for Gemini
  geminiConfig?: GeminiConfig;
  // Default LLM provider
  defaultProvider?: 'claude' | 'ollama' | 'gemini';
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
  geminiApiKey?: string;
  claudeConfig?: ClaudeConfig;
  ollamaConfig?: OllamaConfig;
  geminiConfig?: GeminiConfig;
  defaultProvider?: 'claude' | 'ollama' | 'gemini';
  agents?: Record<string, AgentConfig>;
  systemPromptAppend?: string;
  defaultPermissionMode?: 'approve' | 'ignore';
  autoCheckUpdates?: boolean;
  stravuApiKey?: string;
  stravuServerUrl?: string;
  theme?: 'light' | 'dark';
}