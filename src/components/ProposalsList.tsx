import React from 'react';
import { Stack, Text, Button } from '@mantine/core';
import { Proposal } from '../types';

interface ProposalsListProps {
  proposals: Proposal[];
  onApprove: (proposal: Proposal) => void;
  onReject: (proposal: Proposal) => void;
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
