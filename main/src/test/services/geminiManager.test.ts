import { GeminiManager } from '../../services/geminiManager';
import { ConfigManager } from '../../services/configManager';
import { Logger } from '../../utils/logger';
import { GoogleGenerativeAI, GenerativeModel, ChatSession } from '@google/generative-ai';

// Mocks
jest.mock('@google/generative-ai');
jest.mock('../../services/configManager');
jest.mock('../../utils/logger');

describe('GeminiManager', () => {
  let geminiManager: GeminiManager;
  let mockConfigManager: jest.Mocked<ConfigManager>;
  let mockLogger: jest.Mocked<Logger>;
  let mockGenAIInstance: jest.Mocked<GoogleGenerativeAI>;
  let mockGenModelInstance: jest.Mocked<GenerativeModel>;
  let mockChatSessionInstance: jest.Mocked<ChatSession>;

  const mockReadableStream = (chunks: string[], signal?: AbortSignal) => {
    // Simplified async iterator
    let i = 0;
    const stream = {
      async *[Symbol.asyncIterator]() {
        while (i < chunks.length) {
          if (signal?.aborted) {
            throw new Error('Aborted'); // Simulate SDK behavior on abort
          }
          yield { text: () => chunks[i++] };
          await new Promise(resolve => setTimeout(resolve, 0)); // Ensure microtask switch
        }
      }
    };
    return { stream, result: Promise.resolve({ stream }) }; // sendMessageStream returns a Promise for an object with a stream
  };


  beforeEach(() => {
    jest.clearAllMocks();

    mockConfigManager = new ConfigManager(undefined) as jest.Mocked<ConfigManager>;
    mockLogger = new Logger(mockConfigManager) as jest.Mocked<Logger>;

    mockChatSessionInstance = {
      sendMessageStream: jest.fn(),
      // Mock other ChatSession methods if used
    } as any;

    mockGenModelInstance = {
      getGenerativeModel: jest.fn(), // This is on GenAI, not model
      startChat: jest.fn().mockReturnValue(mockChatSessionInstance),
      // Mock other GenerativeModel methods if used (e.g., generateContentStream directly)
    } as any;

    mockGenAIInstance = {
      getGenerativeModel: jest.fn().mockReturnValue(mockGenModelInstance),
    } as any;

    (GoogleGenerativeAI as jest.MockClass<GoogleGenerativeAI>).mockImplementation(() => mockGenAIInstance);

    // Default config
    mockConfigManager.getConfig = jest.fn().mockReturnValue({
      geminiApiKey: 'test-api-key',
      geminiConfig: { defaultModel: 'gemini-pro' },
      agents: {},
    });

    // Create new instance for each test
    geminiManager = new GeminiManager(mockConfigManager, mockLogger);
  });

  it('should initialize GoogleGenerativeAI with API key from config', () => {
    expect(GoogleGenerativeAI).toHaveBeenCalledWith('test-api-key');
    expect(mockLogger.info).toHaveBeenCalledWith('[GeminiManager] GoogleGenerativeAI SDK initialized with API key.');
  });

  it('should warn if API key is not configured', () => {
    mockConfigManager.getConfig.mockReturnValue({ geminiApiKey: undefined });
    new GeminiManager(mockConfigManager, mockLogger); // Re-initialize
    expect(mockLogger.warn).toHaveBeenCalledWith('[GeminiManager] Gemini API key not configured. GeminiManager will not be functional.');
  });

  it('should re-initialize GenAI if config updates with a new API key', () => {
    // Initial setup
    expect(GoogleGenerativeAI).toHaveBeenCalledTimes(1);

    // Simulate config update
    const newApiKey = 'new-test-api-key';
    mockConfigManager.getConfig.mockReturnValue({ geminiApiKey: newApiKey, geminiConfig: { defaultModel: 'gemini-pro' } });
    // Manually trigger the event listener that GeminiManager sets up
    const configUpdateListener = (mockConfigManager.on as jest.Mock).mock.calls.find(call => call[0] === 'config-updated');
    if (configUpdateListener && configUpdateListener[1]) {
        configUpdateListener[1](); // Call the listener
    }

    expect(GoogleGenerativeAI).toHaveBeenCalledTimes(2);
    expect(GoogleGenerativeAI).toHaveBeenLastCalledWith(newApiKey);
  });


  describe('generateResponse', () => {
    it('should emit error and exit if API key is not configured during generation', async () => {
      (geminiManager as any).genAI = undefined; // Simulate no API key
      const onOutput = jest.fn();
      const onExit = jest.fn();
      geminiManager.on('output', onOutput);
      geminiManager.on('exit', onExit);

      await geminiManager.generateResponse('s1', 'prompt');

      expect(onOutput).toHaveBeenCalledWith(expect.objectContaining({
        data: { type: 'session', data: { status: 'error', message: expect.stringContaining('Gemini API key not configured') } },
      }));
      expect(onExit).toHaveBeenCalledWith({ sessionId: 's1', exitCode: 1, signal: null });
    });

    it('should use default model if no agent-specific model', async () => {
      mockChatSessionInstance.sendMessageStream.mockResolvedValue(mockReadableStream(['response part 1']));
      await geminiManager.generateResponse('s1', 'prompt');
      expect(mockGenAIInstance.getGenerativeModel).toHaveBeenCalledWith({ model: 'gemini-pro' });
    });

    it('should use agent-specific model if configured', async () => {
      mockConfigManager.getConfig.mockReturnValue({
        geminiApiKey: 'test-api-key',
        geminiConfig: { defaultModel: 'gemini-pro' },
        agents: { 'agent1': { provider: 'gemini', model: 'gemini-ultra' } },
      });
      geminiManager = new GeminiManager(mockConfigManager, mockLogger); // Re-init with new config
      mockChatSessionInstance.sendMessageStream.mockResolvedValue(mockReadableStream(['response']));

      await geminiManager.generateResponse('s1', 'prompt', 'agent1');
      expect(mockGenAIInstance.getGenerativeModel).toHaveBeenCalledWith({ model: 'gemini-ultra' });
    });

    it('should fall back to default model if agent has no specific model or provider is not gemini', async () => {
      mockConfigManager.getConfig.mockReturnValue({
        geminiApiKey: 'test-api-key',
        geminiConfig: { defaultModel: 'gemini-default-for-test' },
        agents: {
            'agent1': { provider: 'gemini' }, // No model specified
            'agent2': { provider: 'ollama', model: 'ollama-model'} // Wrong provider
        },
      });
      geminiManager = new GeminiManager(mockConfigManager, mockLogger);
      mockChatSessionInstance.sendMessageStream.mockResolvedValue(mockReadableStream(['response']));

      await geminiManager.generateResponse('s1', 'prompt', 'agent1');
      expect(mockGenAIInstance.getGenerativeModel).toHaveBeenCalledWith({ model: 'gemini-default-for-test' });

      await geminiManager.generateResponse('s2', 'prompt', 'agent2');
      expect(mockGenAIInstance.getGenerativeModel).toHaveBeenCalledWith({ model: 'gemini-default-for-test' });
    });

    it('should emit spawned, output for each chunk, and exit on success', async () => {
      const onSpawned = jest.fn();
      const onOutput = jest.fn();
      const onExit = jest.fn();
      geminiManager.on('spawned', onSpawned);
      geminiManager.on('output', onOutput);
      geminiManager.on('exit', onExit);

      const chunks = ['Hello, ', 'world!', ' This is Gemini.'];
      mockChatSessionInstance.sendMessageStream.mockResolvedValue(mockReadableStream(chunks));

      await geminiManager.generateResponse('s1', 'A prompt to Gemini');

      expect(onSpawned).toHaveBeenCalledWith({ sessionId: 's1' });
      expect(onOutput).toHaveBeenCalledTimes(chunks.length + 1); // Chunks + final complete message
      chunks.forEach((chunkText, index) => {
        expect(onOutput).toHaveBeenNthCalledWith(index + 1, expect.objectContaining({
          sessionId: 's1',
          type: 'json',
          data: { type: 'tool_code', data: chunkText },
        }));
      });
      expect(onOutput).toHaveBeenLastCalledWith(expect.objectContaining({
          data: { type: 'session', data: {status: 'complete', message: 'Gemini generation finished.'}}
      }));
      expect(onExit).toHaveBeenCalledWith({ sessionId: 's1', exitCode: 0, signal: null });
    });

    it('should handle API errors and emit error messages', async () => {
        const onOutput = jest.fn();
        const onError = jest.fn();
        const onExit = jest.fn();
        geminiManager.on('output', onOutput);
        geminiManager.on('error', onError);
        geminiManager.on('exit', onExit);

        const apiError = new Error('Gemini API Error: Invalid request');
        mockChatSessionInstance.sendMessageStream.mockRejectedValue(apiError);

        await geminiManager.generateResponse('s1', 'prompt');

        expect(onOutput).toHaveBeenCalledWith(expect.objectContaining({
            data: { type: 'session', data: { status: 'error', message: 'Gemini API Error', details: expect.stringContaining('Gemini API Error: Invalid request') } },
        }));
        expect(onError).toHaveBeenCalledWith({ sessionId: 's1', error: expect.stringContaining('Gemini API Error: Invalid request') });
        expect(onExit).toHaveBeenCalledWith({ sessionId: 's1', exitCode: 1, signal: null });
    });

    it('should correctly identify API key error', async () => {
        const onOutput = jest.fn();
        geminiManager.on('output', onOutput);
        const apiKeyError = new Error('API key not valid. Please pass a valid API key.');
        mockChatSessionInstance.sendMessageStream.mockRejectedValue(apiKeyError);
        await geminiManager.generateResponse('s1', 'prompt');
        expect(onOutput).toHaveBeenCalledWith(expect.objectContaining({
            data: { type: 'session', data: { status: 'error', details: expect.stringContaining('Gemini API key not valid')}}
        }));
    });

    it('should correctly identify FETCH_ERROR', async () => {
        const onOutput = jest.fn();
        geminiManager.on('output', onOutput);
        const fetchError = new Error('[FETCH_ERROR] Request failed');
        mockChatSessionInstance.sendMessageStream.mockRejectedValue(fetchError);
        await geminiManager.generateResponse('s1', 'prompt');
        expect(onOutput).toHaveBeenCalledWith(expect.objectContaining({
            data: { type: 'session', data: { status: 'error', details: expect.stringContaining('Network error connecting to Gemini API')}}
        }));
    });
  });

  describe('stopSession', () => {
    it('should abort the active stream and emit appropriate events if stream is aborted by SDK', async () => {
      const onOutput = jest.fn();
      const onExit = jest.fn();
      geminiManager.on('output', onOutput);
      geminiManager.on('exit', onExit);

      // Simulate a stream that respects AbortSignal
      const abortController = new AbortController();
      const streamWithAbort = mockReadableStream(['first chunk'], abortController.signal);
      mockChatSessionInstance.sendMessageStream.mockReturnValue(streamWithAbort);

      // Start generation but don't await it fully
      const generationPromise = geminiManager.generateResponse('s1', 'long prompt');

      // Wait for spawned and first chunk
      await new Promise(resolve => geminiManager.once('output', resolve));

      // Now stop the session
      await geminiManager.stopSession('s1');

      // Wait for generation to fully resolve (it should have been aborted)
      await generationPromise;

      expect(mockLogger.info).toHaveBeenCalledWith('[GeminiManager] Attempting to stop stream for session s1');
      expect(mockLogger.info).toHaveBeenCalledWith('[GeminiManager] Stream for session s1 aborted.');
      expect(onOutput).toHaveBeenCalledWith(expect.objectContaining({
        data: { type: 'session', data: {status: 'stopped', message: 'Generation stopped by user.' }}
      }));
      expect(onExit).toHaveBeenCalledWith({ sessionId: 's1', exitCode: 0, signal: 'SIGTERM' });
    });

    it('should emit exit if no active stream to stop', async () => {
      const onExit = jest.fn();
      geminiManager.on('exit', onExit);
      await geminiManager.stopSession('s2'); // No active stream for s2
      expect(onExit).toHaveBeenCalledWith({ sessionId: 's2', exitCode: 0, signal: 'SIGTERM' });
    });
  });

  it('isSessionRunning should return true if a stream is active, false otherwise', async () => {
    expect(geminiManager.isSessionRunning('s1')).toBe(false);

    const stream = mockReadableStream(['chunk1', 'chunk2']);
    mockChatSessionInstance.sendMessageStream.mockResolvedValue(stream);

    const promise = geminiManager.generateResponse('s1', 'prompt');
    // isSessionRunning should be true once generateResponse sets up the stream map
    expect(geminiManager.isSessionRunning('s1')).toBe(true);

    await promise; // Let it complete
    expect(geminiManager.isSessionRunning('s1')).toBe(false);
  });

});
