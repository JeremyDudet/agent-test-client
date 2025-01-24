import React from 'react';
import { Stack, Text, Button } from '@mantine/core';
import { ExpenseProposal } from '../types';

interface ProposalsListProps {
  proposals: ExpenseProposal[];
  onApprove: (proposal: ExpenseProposal) => void;
  onReject: (proposal: ExpenseProposal) => void;
}

export function ProposalsList({ proposals, onApprove, onReject }: ProposalsListProps) {
  return (
    <Stack>
      <Text size="lg" fw={500}>
        Proposals:
      </Text>
      {proposals.map((proposal, index) => (
        <Stack key={index} gap="xs">
          <Text>{JSON.stringify(proposal, null, 2)}</Text>
          <div>
            <Button size="xs" variant="outline" color="green" onClick={() => onApprove(proposal)}>
              Approve
            </Button>
            <Button
              size="xs"
              variant="outline"
              color="red"
              style={{ marginLeft: '0.5rem' }}
              onClick={() => onReject(proposal)}
            >
              Reject
            </Button>
          </div>
        </Stack>
      ))}
    </Stack>
  );
}
