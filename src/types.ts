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
