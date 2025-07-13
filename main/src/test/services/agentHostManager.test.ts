import { AgentHostManager } from '../../services/agentHostManager';
import { ClaudeCodeManager } from '../../services/claudeCodeManager';
import { OllamaManager } from '../../services/ollamaManager';
import { GeminiManager } from '../../services/geminiManager';
import { ConfigManager } from '../../services/configManager';
import { Logger } from '../../utils/logger';
import { SessionManager } from '../../services/sessionManager'; // Assuming this is the correct path
import { EventEmitter }
from 'events';

// Mocks
jest.mock('../../services/claudeCodeManager');
jest.mock('../../services/ollamaManager');
jest.mock('../../services/geminiManager');
jest.mock('../../services/configManager');
jest.mock('../../utils/logger');
jest.mock('../../services/sessionManager');


describe('AgentHostManager', () => {
  let agentHostManager: AgentHostManager;
  let mockConfigManager: jest.Mocked<ConfigManager>;
  let mockSessionManager: jest.Mocked<SessionManager>;
  let mockLogger: jest.Mocked<Logger>;
  let mockClaudeManager: jest.Mocked<ClaudeCodeManager>;
  let mockOllamaManager: jest.Mocked<OllamaManager>;
  let mockGeminiManager: jest.Mocked<GeminiManager>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock instances
    mockConfigManager = new ConfigManager(undefined) as jest.Mocked<ConfigManager>;
    mockSessionManager = new SessionManager(undefined as any) as jest.Mocked<SessionManager>; // Needs a DB mock if used
    mockLogger = new Logger(mockConfigManager) as jest.Mocked<Logger>;

    // Mock the constructors of ClaudeCodeManager and OllamaManager to return our mocked instances
    // And ensure they are event emitters
    mockClaudeManager = new ClaudeCodeManager(mockSessionManager, mockLogger, mockConfigManager, null) as jest.Mocked<ClaudeCodeManager>;
    mockOllamaManager = new OllamaManager(mockConfigManager, mockLogger) as jest.Mocked<OllamaManager>;
    mockGeminiManager = new GeminiManager(mockConfigManager, mockLogger) as jest.Mocked<GeminiManager>;

    // Ensure mocked managers have EventEmitter properties
    Object.assign(mockClaudeManager, EventEmitter.prototype);
    Object.assign(mockOllamaManager, EventEmitter.prototype);
    Object.assign(mockGeminiManager, EventEmitter.prototype);


    (ClaudeCodeManager as jest.MockClass<ClaudeCodeManager>).mockImplementation(() => mockClaudeManager);
    (OllamaManager as jest.MockClass<OllamaManager>).mockImplementation(() => mockOllamaManager);
    (GeminiManager as jest.MockClass<GeminiManager>).mockImplementation(() => mockGeminiManager);


    // Default config
    mockConfigManager.getConfig = jest.fn().mockReturnValue({
      defaultProvider: 'claude',
      claudeConfig: {},
      ollamaConfig: { apiUrl: 'http://localhost:11434', defaultModel: 'default-ollama' },
      agents: {},
    });

    agentHostManager = new AgentHostManager(mockConfigManager, mockSessionManager, mockLogger, null);
  });

  describe('Provider Selection', () => {
    it('should select Claude by default', async () => {
      await agentHostManager.startSession('s1', '/path', 'prompt');
      expect(mockClaudeManager.startSession).toHaveBeenCalled();
      expect(mockOllamaManager.generateResponse).not.toHaveBeenCalled();
      expect(mockGeminiManager.generateResponse).not.toHaveBeenCalled();
    });

    it('should select Ollama if defaultProvider is ollama', async () => {
      mockConfigManager.getConfig.mockReturnValue({ defaultProvider: 'ollama', ollamaConfig: { defaultModel: 'test-ollama' } });
      agentHostManager = new AgentHostManager(mockConfigManager, mockSessionManager, mockLogger, null); // Re-initialize with new config
      await agentHostManager.startSession('s1', '/path', 'prompt');
      expect(mockOllamaManager.generateResponse).toHaveBeenCalled();
      expect(mockClaudeManager.startSession).not.toHaveBeenCalled();
      expect(mockGeminiManager.generateResponse).not.toHaveBeenCalled();
    });

    it('should select Gemini if defaultProvider is gemini', async () => {
      mockConfigManager.getConfig.mockReturnValue({ defaultProvider: 'gemini', geminiConfig: { defaultModel: 'test-gemini' } });
      agentHostManager = new AgentHostManager(mockConfigManager, mockSessionManager, mockLogger, null); // Re-initialize with new config
      await agentHostManager.startSession('s1', '/path', 'prompt');
      expect(mockGeminiManager.generateResponse).toHaveBeenCalled();
      expect(mockClaudeManager.startSession).not.toHaveBeenCalled();
      expect(mockOllamaManager.generateResponse).not.toHaveBeenCalled();
    });

    it('should select provider based on agentId if configured', async () => {
      mockConfigManager.getConfig.mockReturnValue({
        defaultProvider: 'claude',
        ollamaConfig: { defaultModel: 'test-ollama' },
        geminiConfig: { defaultModel: 'test-gemini' },
        agents: {
          'agent-ollama': { provider: 'ollama', model: 'agent-model' },
          'agent-gemini': { provider: 'gemini', model: 'gemini-agent-model'}
        },
      });
      agentHostManager = new AgentHostManager(mockConfigManager, mockSessionManager, mockLogger, null);

      await agentHostManager.startSession('s1', '/path', 'prompt', 'agent-ollama');
      expect(mockOllamaManager.generateResponse).toHaveBeenCalledWith('s1', 'prompt', 'agent-ollama');

      await agentHostManager.startSession('s2', '/path', 'prompt', 'agent-gemini');
      expect(mockGeminiManager.generateResponse).toHaveBeenCalledWith('s2', 'prompt', 'agent-gemini');

      expect(mockClaudeManager.startSession).not.toHaveBeenCalled();
    });

    it('should use default provider if agentId is not in config', async () => {
      mockConfigManager.getConfig.mockReturnValue({
        defaultProvider: 'claude',
        ollamaConfig: { defaultModel: 'test-ollama' },
        agents: { 'another-agent': { provider: 'ollama', model: 'another-model' } },
      });
      agentHostManager = new AgentHostManager(mockConfigManager, mockSessionManager, mockLogger, null);
      await agentHostManager.startSession('s1', '/path', 'prompt', 'unknown-agent');
      expect(mockClaudeManager.startSession).toHaveBeenCalled();
      expect(mockOllamaManager.generateResponse).not.toHaveBeenCalled();
      expect(mockGeminiManager.generateResponse).not.toHaveBeenCalled();
    });
  });

  describe('Method Routing', () => {
    // Test startSession routing (covered by Provider Selection tests implicitly)

    it('should route continueSession to Claude', async () => {
      mockConfigManager.getConfig.mockReturnValue({ defaultProvider: 'claude' });
      agentHostManager = new AgentHostManager(mockConfigManager, mockSessionManager, mockLogger, null);
      // Simulate session started with Claude
      (agentHostManager as any).sessionProviders.set('s1', mockClaudeManager);
      await agentHostManager.continueSession('s1', '/path', 'new prompt', []);
      expect(mockClaudeManager.continueSession).toHaveBeenCalledWith('s1', '/path', 'new prompt', [], undefined);
    });

    it('should route continueSession to Ollama', async () => {
      mockConfigManager.getConfig.mockReturnValue({ defaultProvider: 'ollama', ollamaConfig: { defaultModel: 'test-ollama' } });
      agentHostManager = new AgentHostManager(mockConfigManager, mockSessionManager, mockLogger, null);
      (agentHostManager as any).sessionProviders.set('s1', mockOllamaManager);
      await agentHostManager.continueSession('s1', '/path', 'new prompt', [], 'agent1');
      expect(mockOllamaManager.generateResponse).toHaveBeenCalledWith('s1', 'new prompt', 'agent1', []);
    });

    it('should route continueSession to Gemini', async () => {
      mockConfigManager.getConfig.mockReturnValue({ defaultProvider: 'gemini', geminiConfig: { defaultModel: 'test-gemini' } });
      agentHostManager = new AgentHostManager(mockConfigManager, mockSessionManager, mockLogger, null);
      (agentHostManager as any).sessionProviders.set('s1', mockGeminiManager);
      await agentHostManager.continueSession('s1', '/path', 'new prompt', [], 'agent1');
      expect(mockGeminiManager.generateResponse).toHaveBeenCalledWith('s1', 'new prompt', 'agent1', []);
    });

    it('should determine provider for continueSession if not already tracked', async () => {
      mockConfigManager.getConfig.mockReturnValue({ defaultProvider: 'ollama', ollamaConfig: { defaultModel: 'test-ollama' } });
      agentHostManager = new AgentHostManager(mockConfigManager, mockSessionManager, mockLogger, null);
      // No provider set for 's1' in sessionProviders map
      await agentHostManager.continueSession('s1', '/path', 'new prompt', [], 'agent1');
      expect(mockOllamaManager.generateResponse).toHaveBeenCalledWith('s1', 'new prompt', 'agent1', []);
      expect((agentHostManager as any).sessionProviders.get('s1')).toBe(mockOllamaManager);
    });

    it('should route stopSession to the correct provider', async () => {
      (agentHostManager as any).sessionProviders.set('s1-claude', mockClaudeManager);
      (agentHostManager as any).sessionProviders.set('s1-ollama', mockOllamaManager);
      (agentHostManager as any).sessionProviders.set('s1-gemini', mockGeminiManager);

      await agentHostManager.stopSession('s1-claude');
      expect(mockClaudeManager.stopSession).toHaveBeenCalledWith('s1-claude');

      await agentHostManager.stopSession('s1-ollama');
      expect(mockOllamaManager.stopSession).toHaveBeenCalledWith('s1-ollama');

      await agentHostManager.stopSession('s1-gemini');
      expect(mockGeminiManager.stopSession).toHaveBeenCalledWith('s1-gemini');
    });

    it('should attempt to stop all providers if provider not found for stopSession', async () => {
      await agentHostManager.stopSession('s-unknown');
      expect(mockClaudeManager.stopSession).toHaveBeenCalledWith('s-unknown');
      expect(mockOllamaManager.stopSession).toHaveBeenCalledWith('s-unknown');
      expect(mockGeminiManager.stopSession).toHaveBeenCalledWith('s-unknown'); // Check Gemini too
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('stopSession called for s-unknown but no active provider found'));
    });

    it('should route sendInput to Claude if it is the provider', () => {
      (agentHostManager as any).sessionProviders.set('s1', mockClaudeManager);
      mockClaudeManager.sendInput = jest.fn(); // Ensure sendInput is a mock function
      agentHostManager.sendInput('s1', 'hello');
      expect(mockClaudeManager.sendInput).toHaveBeenCalledWith('s1', 'hello');
    });

    it('should warn if sendInput is called for Ollama or Gemini', () => {
      (agentHostManager as any).sessionProviders.set('s-ollama', mockOllamaManager);
      agentHostManager.sendInput('s-ollama', 'hello');
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('sendInput called for API-based session s-ollama, which is not supported'));

      (agentHostManager as any).sessionProviders.set('s-gemini', mockGeminiManager);
      agentHostManager.sendInput('s-gemini', 'hello');
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('sendInput called for API-based session s-gemini, which is not supported'));
    });
  });

  describe('Event Forwarding', () => {
    it('should forward "output" event from Claude', () => {
      const outputHandler = jest.fn();
      agentHostManager.on('output', outputHandler);
      mockClaudeManager.emit('output', { data: 'claude output' });
      expect(outputHandler).toHaveBeenCalledWith({ data: 'claude output' });
    });

    it('should forward "exit" event from Ollama and clear provider mapping', () => {
      const exitHandler = jest.fn();
      agentHostManager.on('exit', exitHandler);
      (agentHostManager as any).sessionProviders.set('s1', mockOllamaManager);

      mockOllamaManager.emit('exit', { sessionId: 's1', exitCode: 0 });

      expect(exitHandler).toHaveBeenCalledWith({ sessionId: 's1', exitCode: 0 });
      expect((agentHostManager as any).sessionProviders.has('s1')).toBe(false);
    });

    // Add more tests for other events (error, spawned) from both providers
  });

  describe('Management Methods', () => {
    it('handleConfigUpdate should call clearAvailabilityCache on ClaudeManager', () => {
      mockClaudeManager.clearAvailabilityCache = jest.fn();
      agentHostManager.handleConfigUpdate();
      expect(mockClaudeManager.clearAvailabilityCache).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Configuration updated. Clearing Claude availability cache."));
    });

    it('shutdown should call killAllProcesses on ClaudeManager', async () => {
      mockClaudeManager.killAllProcesses = jest.fn().mockResolvedValue(undefined);
      await agentHostManager.shutdown();
      expect(mockClaudeManager.killAllProcesses).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Shutting down all providers..."));
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Claude processes killed."));
    });
  });

  describe('isSessionRunning', () => {
    it('should call isSessionRunning on the correct provider', () => {
      (agentHostManager as any).sessionProviders.set('s1-claude', mockClaudeManager);
      mockClaudeManager.isSessionRunning = jest.fn().mockReturnValue(true);

      const isRunning = agentHostManager.isSessionRunning('s1-claude');

      expect(mockClaudeManager.isSessionRunning).toHaveBeenCalledWith('s1-claude');
      expect(isRunning).toBe(true);
    });

    it('should return false if provider not found for session', () => {
      const isRunning = agentHostManager.isSessionRunning('s-unknown');
      expect(isRunning).toBe(false);
    });
  });
});
