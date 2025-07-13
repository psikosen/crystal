import { EventEmitter } from 'events';
import type { ConfigManager } from './configManager';
import type { Logger } from '../utils/logger';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, GenerationConfig, Content } from '@google/generative-ai';

// Define interfaces for simplified conversation history if needed, or use Content directly
// For now, we assume conversationHistory will be an array of Content objects.

export class GeminiManager extends EventEmitter {
  private configManager: ConfigManager;
  private logger?: Logger;
  private genAI?: GoogleGenerativeAI;

  // To keep track of active streaming requests that might need to be stopped.
  // Store AbortController for each session.
  private activeStreams: Map<string, AbortController> = new Map();


  constructor(configManager: ConfigManager, logger?: Logger) {
    super();
    this.configManager = configManager;
    this.logger = logger;
    this.setMaxListeners(50);
    this.initializeGenAI();

    // Re-initialize if API key changes
    this.configManager.on('config-updated', () => {
        this.initializeGenAI();
    });
  }

  private initializeGenAI() {
    const apiKey = this.configManager.getConfig().geminiApiKey;
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.logger?.info('[GeminiManager] GoogleGenerativeAI SDK initialized with API key.');
    } else {
      this.genAI = undefined; // Clear instance if API key is removed
      this.logger?.warn('[GeminiManager] Gemini API key not configured. GeminiManager will not be functional.');
    }
  }

  // Helper to convert simple history to Gemini's Content format if necessary
  // For now, assumes history is already in Gemini's Content[] format.
  private formatConversationHistory(history?: any[]): Content[] | undefined {
    if (!history || history.length === 0) return undefined;
    // Assuming history is already {role: "user" | "model", parts: [{text: string}]}[]
    return history as Content[];
  }

  async generateResponse(
    sessionId: string,
    prompt: string,
    agentId?: string,
    conversationHistory?: any[] // Should be Content[]
  ): Promise<void> {
    if (!this.genAI) {
      const errorMsg = 'Gemini API key not configured. Please set your Gemini API key in settings.';
      this.logger?.error(`[GeminiManager] ${errorMsg}`);
      this.emit('output', {
        sessionId,
        type: 'json',
        data: { type: 'session', data: { status: 'error', message: errorMsg } },
        timestamp: new Date(),
      });
      this.emit('exit', { sessionId, exitCode: 1, signal: null });
      return;
    }

    const config = this.configManager.getConfig();
    const geminiConfig = config.geminiConfig || {};

    let modelName: string | undefined;
    if (agentId && config.agents && config.agents[agentId]?.provider === 'gemini') {
      modelName = config.agents[agentId]?.model;
    }
    modelName = modelName || geminiConfig.defaultModel || 'gemini-pro'; // Default to gemini-pro

    this.logger?.verbose(`[GeminiManager] Using model for session ${sessionId}: ${modelName}`);

    const model = this.genAI.getGenerativeModel({ model: modelName });

    const generationConfig: GenerationConfig = {
      // Configure temperature, topP, topK, maxOutputTokens as needed
      // For now, use SDK defaults or allow via geminiConfig in AppConfig later
      temperature: 0.7, // Example
      maxOutputTokens: 4096, // Example
    };

    // Safety settings - adjust as needed
    const safetySettings = [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    ];

    const history = this.formatConversationHistory(conversationHistory);

    this.emit('spawned', { sessionId });

    const abortController = new AbortController();
    this.activeStreams.set(sessionId, abortController);

    try {
      const chat = model.startChat({
        history,
        generationConfig,
        safetySettings,
      });

      // Using generateContentStream for streaming
      const result = await chat.sendMessageStream(prompt);

      let fullResponseText = "";
      for await (const chunk of result.stream) {
        if (abortController.signal.aborted) {
          this.logger?.info(`[GeminiManager] Stream for session ${sessionId} aborted.`);
          this.emit('output', {
            sessionId, type: 'json',
            data: { type: 'session', data: { status: 'stopped', message: 'Generation stopped by user.'}},
            timestamp: new Date()
          });
          this.emit('exit', { sessionId, exitCode: 0, signal: 'SIGTERM' }); // Simulate user stop
          return;
        }

        const chunkText = chunk.text();
        fullResponseText += chunkText;
        this.logger?.verbose(`[GeminiManager] Received chunk for session ${sessionId}: ${chunkText.substring(0, 50)}...`);
        this.emit('output', {
          sessionId,
          type: 'json', // Simulate Claude's JSON output structure
          data: { type: 'tool_code', data: chunkText }, // This part needs to match what UI expects
          timestamp: new Date(),
        });
      }

      // After stream is finished
      this.logger?.info(`[GeminiManager] Gemini generation complete for session ${sessionId}. Full response length: ${fullResponseText.length}`);
      this.emit('output', {
        sessionId,
        type: 'json',
        data: { type: 'session', data: { status: 'complete', message: 'Gemini generation finished.'} },
        timestamp: new Date()
      });
      this.emit('exit', { sessionId, exitCode: 0, signal: null });

    } catch (error: any) {
      let errorMsg = `Error during Gemini request for session ${sessionId}: ${error.message}`;
      if (error.toString().includes('API key not valid')) {
          errorMsg = 'Gemini API key not valid. Please check your API key in settings.';
      } else if (error.message.includes('FETCH_ERROR')) {
          errorMsg = `Network error connecting to Gemini API: ${error.message}. Please check your internet connection.`;
      }

      this.logger?.error(`[GeminiManager] ${errorMsg}`, error);
      this.emit('output', {
        sessionId,
        type: 'json',
        data: { type: 'session', data: { status: 'error', message: 'Gemini API Error', details: errorMsg } },
        timestamp: new Date(),
      });
      this.emit('error', { sessionId, error: errorMsg });
      this.emit('exit', { sessionId, exitCode: 1, signal: null });
    } finally {
        this.activeStreams.delete(sessionId);
    }
  }

  async stopSession(sessionId: string): Promise<void> {
    const abortController = this.activeStreams.get(sessionId);
    if (abortController) {
      this.logger?.info(`[GeminiManager] Attempting to stop stream for session ${sessionId}`);
      abortController.abort(); // Signal the stream to stop
      // The actual 'exit' event will be emitted by generateResponse when the stream loop breaks
    } else {
      this.logger?.info(`[GeminiManager] No active stream to stop for session ${sessionId}, emitting exit event.`);
      // If no active stream, emit exit directly to signify it's "stopped"
      this.emit('exit', { sessionId, exitCode: 0, signal: 'SIGTERM' });
    }
  }

  isSessionRunning(sessionId: string): boolean {
    return this.activeStreams.has(sessionId);
  }
}
