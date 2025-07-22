import { OllamaManager } from '../../services/ollamaManager';
import { ConfigManager } from '../../services/configManager';
import { Logger } from '../../utils/logger';
import fetch from 'node-fetch';

// Mock node-fetch
jest.mock('node-fetch', () => jest.fn());

const { Response } = jest.requireActual('node-fetch');

describe('OllamaManager', () => {
  let ollamaManager: OllamaManager;
  let mockConfigManager: jest.Mocked<ConfigManager>;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    // Create a basic mock for ConfigManager
    mockConfigManager = {
      getConfig: jest.fn().mockReturnValue({
        ollamaConfig: { apiUrl: 'http://localhost:11434', defaultModel: 'default-model' },
        agents: {},
        defaultProvider: 'ollama',
      }),
      // Add other methods if OllamaManager starts using them
    } as any;

    // Create a basic mock for Logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      verbose: jest.fn(),
    } as any;

    ollamaManager = new OllamaManager(mockConfigManager, mockLogger);
    (fetch as jest.Mock).mockClear();
  });

  const mockStreamResponse = (chunks: any[], finalDone: boolean = true) => {
    let callCount = 0;
    const mockReader = {
      read: jest.fn(async () => {
        if (callCount < chunks.length) {
          const chunk = chunks[callCount++];
          // Ollama streams JSON strings separated by newlines
          const encodedChunk = new TextEncoder().encode(JSON.stringify(chunk) + '\\n');
          return { done: false, value: encodedChunk };
        } else {
          return { done: true, value: undefined };
        }
      }),
    };
    const mockResponse = new Response(null, { status: 200 });
    mockResponse.body = {
      getReader: () => mockReader,
    } as any; // ReadableStream<Uint8Array>
    (fetch as jest.Mock).mockResolvedValue(mockResponse);
    return mockReader;
  };

  const mockErrorResponse = (status: number, bodyText: string) => {
    const mockResponse = new Response(bodyText, { status });
     (fetch as jest.Mock).mockResolvedValue(mockResponse);
  };

  it('should send a request to the configured Ollama API URL and model', async () => {
    mockStreamResponse([{ response: 'Hello', done: false }, { response: ' World', done: true }]);
    await ollamaManager.generateResponse('session1', 'Test prompt');

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/generate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          model: 'default-model',
          prompt: 'Test prompt',
          stream: true,
          history: undefined,
        }),
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('should use agent-specific model if configured', async () => {
    mockConfigManager.getConfig.mockReturnValue({
      ollamaConfig: { apiUrl: 'http://localhost:11434', defaultModel: 'default-model' },
      agents: {
        'agent123': { provider: 'ollama', model: 'agent-specific-model' },
      },
      defaultProvider: 'ollama',
    });
    mockStreamResponse([{ response: 'Test', done: true }]);
    await ollamaManager.generateResponse('session1', 'Test prompt', 'agent123');

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify(expect.objectContaining({ model: 'agent-specific-model' })),
      })
    );
  });

  it('should fall back to default model if agent-specific provider is not ollama', async () => {
    mockConfigManager.getConfig.mockReturnValue({
      ollamaConfig: { apiUrl: 'http://localhost:11434', defaultModel: 'default-model' },
      agents: {
        'agent123': { provider: 'claude', model: 'should-not-be-used' },
      },
      defaultProvider: 'ollama',
    });
    mockStreamResponse([{ response: 'Test', done: true }]);
    await ollamaManager.generateResponse('session1', 'Test prompt', 'agent123');

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify(expect.objectContaining({ model: 'default-model' })),
      })
    );
  });


  it('should emit error and exit if no model is configured', async () => {
    mockConfigManager.getConfig.mockReturnValue({
      ollamaConfig: { apiUrl: 'http://localhost:11434' }, // No defaultModel
      agents: {},
      defaultProvider: 'ollama',
    });
    const onOutput = jest.fn();
    const onExit = jest.fn();
    ollamaManager.on('output', onOutput);
    ollamaManager.on('exit', onExit);

    await ollamaManager.generateResponse('session1', 'Test prompt');

    expect(fetch).not.toHaveBeenCalled();
    expect(onOutput).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session1',
      type: 'json',
      data: { type: 'session', data: { status: 'error', message: expect.stringContaining('Ollama model not configured') } },
    }));
    expect(onExit).toHaveBeenCalledWith({ sessionId: 'session1', exitCode: 1, signal: null });
  });

  it('should emit "spawned", "output" for each chunk, and "exit" on successful stream completion', async () => {
    const chunks = [
      { response: 'First part. ', done: false },
      { response: 'Second part.', done: false },
      { response: ' Final part.', done: true },
    ];
    mockStreamResponse(chunks);

    const onSpawned = jest.fn();
    const onOutput = jest.fn();
    const onExit = jest.fn();
    ollamaManager.on('spawned', onSpawned);
    ollamaManager.on('output', onOutput);
    ollamaManager.on('exit', onExit);

    await ollamaManager.generateResponse('session1', 'Test prompt');

    expect(onSpawned).toHaveBeenCalledWith({ sessionId: 'session1' });
    expect(onOutput).toHaveBeenCalledTimes(chunks.length + 1); // Each chunk + final "complete" message

    chunks.forEach((chunk, index) => {
      expect(onOutput).toHaveBeenNthCalledWith(index + 1, expect.objectContaining({
        sessionId: 'session1',
        type: 'json',
        data: { type: 'tool_code', data: chunk.response },
      }));
    });

    expect(onOutput).toHaveBeenLastCalledWith(expect.objectContaining({
        sessionId: 'session1',
        type: 'json',
        data: { type: 'session', data: {status: 'complete', message: 'Ollama generation finished.'}}
    }));

    expect(onExit).toHaveBeenCalledWith({ sessionId: 'session1', exitCode: 0, signal: null });
  });

  it('should handle Ollama API errors and emit error messages', async () => {
    mockErrorResponse(500, 'Internal Server Error');

    const onOutput = jest.fn();
    const onExit = jest.fn();
    ollamaManager.on('output', onOutput);
    ollamaManager.on('exit', onExit);

    await ollamaManager.generateResponse('session1', 'Test prompt');

    expect(onOutput).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session1',
      type: 'json',
      data: { type: 'session', data: { status: 'error', message: 'Ollama API Error', details: expect.stringContaining('500 Internal Server Error') } },
    }));
    expect(onExit).toHaveBeenCalledWith({ sessionId: 'session1', exitCode: 1, signal: null });
  });

  it('should handle network errors during fetch and emit error messages', async () => {
    (fetch as jest.Mock).mockRejectedValue(new Error('Network failed'));

    const onOutput = jest.fn();
    const onError = jest.fn();
    const onExit = jest.fn();
    ollamaManager.on('output', onOutput);
    ollamaManager.on('error', onError);
    ollamaManager.on('exit', onExit);

    await ollamaManager.generateResponse('session1', 'Test prompt');

    expect(onOutput).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session1',
      type: 'json',
      data: { type: 'session', data: { status: 'error', message: 'Ollama Request Error', details: expect.stringContaining('Network failed') } },
    }));
    expect(onError).toHaveBeenCalledWith({ sessionId: 'session1', error: expect.stringContaining('Network failed') });
    expect(onExit).toHaveBeenCalledWith({ sessionId: 'session1', exitCode: 1, signal: null });
  });

  it('should emit stderr if a stream chunk is not valid JSON', async () => {
    const mockReader = {
      read: jest.fn()
        .mockReturnValueOnce(Promise.resolve({ done: false, value: new TextEncoder().encode('this is not json\\n') }))
        .mockReturnValueOnce(Promise.resolve({ done: true, value: undefined }))
    };
    const mockResponse = new Response(null, { status: 200 });
    mockResponse.body = { getReader: () => mockReader } as any;
    (fetch as jest.Mock).mockResolvedValue(mockResponse);

    const onOutput = jest.fn();
    ollamaManager.on('output', onOutput);

    await ollamaManager.generateResponse('session1', 'Test prompt');

    expect(onOutput).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session1',
      type: 'stderr',
      data: 'Error parsing Ollama stream: this is not json\\n',
    }));
  });

  describe('stopSession', () => {
    it('should emit "exit" event for the session', async () => {
      const onExit = jest.fn();
      ollamaManager.on('exit', onExit);

      await ollamaManager.stopSession('session1');

      expect(onExit).toHaveBeenCalledWith({ sessionId: 'session1', exitCode: 0, signal: 'SIGTERM' });
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Stop requested for session session1'));
    });
  });
});
