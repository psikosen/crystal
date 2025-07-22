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
  gitRepoPath: string;
  verbose?: boolean;
  anthropicApiKey?: string;
  geminiApiKey?: string;
  systemPromptAppend?: string;
  runScript?: string[];
  claudeConfig?: ClaudeConfig;
  ollamaConfig?: OllamaConfig;
  geminiConfig?: GeminiConfig;
  defaultProvider?: 'claude' | 'ollama' | 'gemini';
  agents?: Record<string, AgentConfig>;
  defaultPermissionMode?: 'approve' | 'ignore';
  autoCheckUpdates?: boolean;
  stravuApiKey?: string;
  stravuServerUrl?: string;
  theme?: 'light' | 'dark';
}