// Example of how you might structure your proposals.
// Adjust to match the shape of the data returned by your backend.
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
