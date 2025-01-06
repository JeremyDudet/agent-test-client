// Example of how you might structure your proposals.
// Adjust to match the shape of the data returned by your backend.
export interface Proposal {
  description: string;
  amount: number;
  suggestedCategory: string;
  confidence?: number;
}
