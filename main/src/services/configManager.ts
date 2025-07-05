import { EventEmitter } from 'events';
import type { AppConfig, ClaudeConfig, OllamaConfig } from '../types/config';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getCrystalDirectory } from '../utils/crystalDirectory';

export class ConfigManager extends EventEmitter {
  private config: AppConfig;
  private configPath: string;
  private configDir: string;

  constructor(defaultGitPath?: string) {
    super();
    this.configDir = getCrystalDirectory();
    this.configPath = path.join(this.configDir, 'config.json');
    this.config = {
      gitRepoPath: defaultGitPath || os.homedir(),
      verbose: false,
      anthropicApiKey: undefined,
      systemPromptAppend: undefined,
      runScript: undefined,
      claudeConfig: { executablePath: undefined },
      ollamaConfig: { apiUrl: 'http://localhost:11434', defaultModel: undefined },
      defaultProvider: 'claude',
      agents: {},
      defaultPermissionMode: 'ignore',
      stravuApiKey: undefined,
      stravuServerUrl: 'https://api.stravu.com'
    };
  }

  async initialize(): Promise<void> {
    // Ensure the config directory exists
    await fs.mkdir(this.configDir, { recursive: true });
    
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      const loadedConfig = JSON.parse(data);
      // Merge loaded config with defaults to ensure new fields are present
      this.config = { ...this.config, ...loadedConfig };
      // Ensure nested config objects are also merged or initialized
      this.config.claudeConfig = { ...this.config.claudeConfig, ...loadedConfig.claudeConfig };
      this.config.ollamaConfig = { ...this.config.ollamaConfig, ...loadedConfig.ollamaConfig };
      this.config.agents = { ...this.config.agents, ...loadedConfig.agents };

    } catch (error) {
      // Config file doesn't exist or is invalid, use defaults and save
      await this.saveConfig();
    }
  }

  private async saveConfig(): Promise<void> {
    await fs.mkdir(this.configDir, { recursive: true });
    await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
  }

  getConfig(): AppConfig {
    // Always return dark theme
    return { ...this.config, theme: 'dark' };
  }

  async updateConfig(updates: Partial<AppConfig>): Promise<AppConfig> {
    // Filter out theme updates - always dark mode
    const { theme, ...filteredUpdates } = updates;

    // Deep merge for nested config objects
    const newConfig = { ...this.config };
    if (filteredUpdates.claudeConfig) {
      newConfig.claudeConfig = { ...newConfig.claudeConfig, ...filteredUpdates.claudeConfig };
    }
    if (filteredUpdates.ollamaConfig) {
      newConfig.ollamaConfig = { ...newConfig.ollamaConfig, ...filteredUpdates.ollamaConfig };
    }
    if (filteredUpdates.agents) {
      newConfig.agents = { ...newConfig.agents, ...filteredUpdates.agents };
    }

    // Apply other updates
    for (const key in filteredUpdates) {
      if (key !== 'claudeConfig' && key !== 'ollamaConfig' && key !== 'agents') {
        (newConfig as any)[key] = (filteredUpdates as any)[key];
      }
    }

    this.config = newConfig;
    await this.saveConfig();
    this.emit('config-updated', this.config);
    return this.getConfig();
  }

  getGitRepoPath(): string {
    return this.config.gitRepoPath || '';
  }

  isVerbose(): boolean {
    return this.config.verbose || false;
  }

  getDatabasePath(): string {
    return path.join(this.configDir, 'sessions.db');
  }

  getAnthropicApiKey(): string | undefined {
    return this.config.anthropicApiKey;
  }

  getSystemPromptAppend(): string | undefined {
    return this.config.systemPromptAppend;
  }

  getRunScript(): string[] | undefined {
    return this.config.runScript;
  }

  getStravuApiKey(): string | undefined {
    return this.config.stravuApiKey;
  }

  getStravuServerUrl(): string {
    return this.config.stravuServerUrl || 'https://api.stravu.com';
  }
}