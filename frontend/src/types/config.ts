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
  gitRepoPath: string;
  verbose?: boolean;
  anthropicApiKey?: string;
  systemPromptAppend?: string;
  runScript?: string[];
  claudeConfig?: ClaudeConfig;
  ollamaConfig?: OllamaConfig;
  defaultProvider?: 'claude' | 'ollama';
  agents?: Record<string, AgentConfig>;
  defaultPermissionMode?: 'approve' | 'ignore';
  autoCheckUpdates?: boolean;
  stravuApiKey?: string;
  stravuServerUrl?: string;
  theme?: 'light' | 'dark';
}