import { VoiceActivityDetectionOptions } from 'voice-activity-detection';

export interface Proposal {
  description: string;
  amount: number;
  suggestedCategory: string;
  confidence: number;
  semanticContext?: {
    temporalReference?: string;
    relatedEntities?: string[];
    confidence: number;
  };
}

export interface SemanticUnit {
  timestamp: number;
  confidence: number;
  context: {
    complete: boolean;
    requires_clarification: boolean;
    related_units?: string[];
  };
}

export interface SemanticContext {
  timestamp: number;
  isComplete: boolean;
  confidence: number;
  temporalContext?: {
    previousMentions: string[];
    relatedExpenses: string[];
    timeReference?: string;
  };
  learningContext?: {
    userPatterns: string[];
    commonCorrections: string[];
  };
}

export interface QueuedAudioChunk {
  audio: ArrayBuffer;
  context: SemanticContext;
  timestamp: number;
  sequenceId: number;
}

export interface AudioChunk {
  audio: ArrayBuffer;
  context: SemanticContext;
  timestamp: number;
}

export interface QueueState {
  isProcessing: boolean;
  chunks: AudioChunk[];
}

export interface TranscriptionResponse {
  success: boolean;
  error?: string;
  transcription?: string;
  sequenceId: number;
}

export interface AudioChunkMetadata {
  sequenceId: number;
  timestamp: number;
  isProcessed: boolean;
  transcription?: string;
}

export interface ExtendedVADOptions extends VoiceActivityDetectionOptions {
  onUpdate?: (amplitude: number) => void;
  onSilence?: (duration: number) => void;
  minSpeechDuration?: number;
  maxSpeechDuration?: number;
  silenceDuration?: number;
  audioBuffering?: {
    enabled: boolean;
    duration: number;
  };
}

// Re-export the VAD instance type
export interface VADInstance {
  destroy: () => void;
}

export interface VADMetrics {
  cycleId: number;
  startTime: number;
  endTime: number | null;
  duration: number | null;
  audioChunks: number;
  averageAmplitude: number;
  totalAmplitudeReadings: number;
  sumAmplitude: number;
  silenceDuration: number;
  voiceActivityRatio: number;
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface TimeContext {
  now: Date;
  formattedNow: string;
  timeZone: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  description: string;
}

export interface MessageWindow {
  processedMessages: Message[];
  newMessages: Message[];
  windowSize: number;
}

export interface AgentState {
  isProcessing: boolean;
  messageWindow: MessageWindow;
  existingProposals: ExpenseProposal[];
  userExpenseCategories: ExpenseCategory[];
  timeContext: TimeContext;
}

export interface ExpenseProposal {
  id: string;
  status: 'draft' | 'pending_review' | 'confirmed' | 'rejected';
  action: string;
  item: string;
  amount: number;
  date: string;
  category: string;
  originalText: string;
  created_at: string;
}
