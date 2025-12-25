# FHE Werewolf

A minimal on-chain Werewolf (Mafia) game where **roles and votes stay private**.
Even the deployer/operator cannot see players’ roles or individual votes.

- Smart contract: `contracts/FHEWerewolf.sol`
- Web UI (Vite + React): `apps/web`

This dApp runs on **Sepolia** and uses **FHE (Fully Homomorphic Encryption)** via the FHEVM stack.

## What is private vs public

- Encrypted (never revealed): player roles, individual votes, vote tallies
- Public (revealed at the end): eliminated player, winning side

## Architecture (no backend)

Browser (MetaMask)
→ encrypt inputs + request decryptions via Relayer SDK
→ FHE Werewolf smart contract (encrypted computation)
→ only the final outcome is revealed on-chain

## Game rules (MVP)

- Players: 5 (fixed)
- Roles: 1 werewolf, 4 villagers (assigned privately)
- Flow:
	1. Join (playerId 0–4)
	2. Vote Round 1 (encrypted)
	3. Finalize round 1
	4. If tie → Vote Round 2 (encrypted)
	5. Reveal final result (public)

## Requirements

- Node.js 20+
- MetaMask
- Sepolia ETH for transactions




