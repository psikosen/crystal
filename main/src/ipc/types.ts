import type { App, BrowserWindow } from 'electron';
import type { TaskQueue } from '../services/taskQueue';
import type { SessionManager } from '../services/sessionManager';
import type { ConfigManager } from '../services/configManager';
import type { WorktreeManager } from '../services/worktreeManager';
import type { WorktreeNameGenerator } from '../services/worktreeNameGenerator';
import type { GitDiffManager } from '../services/gitDiffManager';
import type { ExecutionTracker } from '../services/executionTracker';
import type { DatabaseService } from '../database/database';
import type { RunCommandManager } from '../services/runCommandManager';
import type { VersionChecker } from '../services/versionChecker';
import type { StravuAuthManager } from '../services/stravuAuthManager';
import type { StravuNotebookService } from '../services/stravuNotebookService';
// import type { ClaudeCodeManager } from '../services/claudeCodeManager'; // Replaced by AgentHostManager
import type { AgentHostManager } from '../services/agentHostManager'; // Import AgentHostManager

export interface AppServices {
  app: App;
  configManager: ConfigManager;
  databaseService: DatabaseService;
  sessionManager: SessionManager;
  worktreeManager: WorktreeManager;
  agentHostManager: AgentHostManager; // Renamed from claudeCodeManager
  gitDiffManager: GitDiffManager;
  executionTracker: ExecutionTracker;
  worktreeNameGenerator: WorktreeNameGenerator;
  runCommandManager: RunCommandManager;
  versionChecker: VersionChecker;
  stravuAuthManager: StravuAuthManager;
  stravuNotebookService: StravuNotebookService;
  taskQueue: TaskQueue | null;
  getMainWindow: () => BrowserWindow | null;
} 