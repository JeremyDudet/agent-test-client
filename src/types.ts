// Example of how you might structure your proposals.
// Adjust to match the shape of the data returned by your backend.
export interface Proposal {
  id?: string;
  description?: string;
  amount?: number;
  // ...any other fields returned from the backend
}
