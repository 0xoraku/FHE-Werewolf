export const FHEWerewolfAbi = [
  // views
  {
    inputs: [],
    name: 'getMyPlayerId',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'getMyRoleHandle',
    outputs: [{ internalType: 'ebool', name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'phase',
    outputs: [{ internalType: 'enum FHEWerewolf.Phase', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'voteRound',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'gameEnded',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'eliminatedPlayer',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'villagersWin',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },

  // gameplay
  {
    inputs: [{ internalType: 'uint8', name: 'playerId', type: 'uint8' }],
    name: 'join',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint8', name: 'playerId', type: 'uint8' },
      { internalType: 'externalEuint8', name: 'voteExt', type: 'bytes32' },
      { internalType: 'bytes', name: 'inputProof', type: 'bytes' },
    ],
    name: 'submitVote',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'finalizeGame',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes', name: 'abiEncodedCleartexts', type: 'bytes' },
      { internalType: 'bytes', name: 'decryptionProof', type: 'bytes' },
      { internalType: 'bytes32[]', name: 'handlesList', type: 'bytes32[]' },
    ],
    name: 'revealTie',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes', name: 'abiEncodedCleartexts', type: 'bytes' },
      { internalType: 'bytes', name: 'decryptionProof', type: 'bytes' },
      { internalType: 'bytes32[]', name: 'handlesList', type: 'bytes32[]' },
    ],
    name: 'revealResult',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },

  // events
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: 'bytes32', name: 'isTieHandle', type: 'bytes32' },
    ],
    name: 'Round1Finalized',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'bytes32',
        name: 'eliminatedIndexHandle',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'bytes32',
        name: 'villagersWinHandle',
        type: 'bytes32',
      },
    ],
    name: 'Finalizing',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: 'bool', name: 'isTie', type: 'bool' },
    ],
    name: 'TieRevealed',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: false, internalType: 'uint8', name: 'eliminatedPlayer', type: 'uint8' },
      { indexed: false, internalType: 'bool', name: 'villagersWin', type: 'bool' },
    ],
    name: 'ResultRevealed',
    type: 'event',
  },
] as const;

export const PhaseLabel: Record<number, string> = {
  0: 'Join',
  1: 'VoteRound1',
  2: 'WaitingTieReveal',
  3: 'VoteRound2',
  4: 'Finalizing',
  5: 'Revealed',
};
