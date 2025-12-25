FHE Werewolf

A Werewolf game where even the game master cannot see players’ roles or votes

⸻

Overview

FHE Werewolf is a minimal social deduction game built with Zama’s Fully Homomorphic Encryption (FHE).

Unlike traditional online Werewolf games, this implementation removes the need for a trusted game master or server.
Player roles and votes are never revealed to anyone — including the contract deployer.

Only the final outcome is made public.

⸻

Problem

Online multiplayer games with hidden information (e.g. Werewolf, Mafia) require a trusted party:
	•	A game master
	•	A server operator
	•	Or backend logic that knows all roles and votes

This creates fundamental issues:
	•	The operator can cheat or manipulate results
	•	Players must blindly trust the infrastructure
	•	True fairness cannot be cryptographically verified

⸻

Solution

We use Fully Homomorphic Encryption (FHE) to process hidden information without revealing it.

With FHE:
	•	Player roles remain encrypted at all times
	•	Votes are encrypted and aggregated without decryption
	•	The contract computes the result without knowing any secrets

Even the game master has no privileged view.

⸻

Why FHE Is Necessary

Traditional encryption fails because the system must eventually decrypt data to compute results.

FHE enables:
	•	Computation on encrypted roles
	•	Computation on encrypted votes
	•	Secure aggregation without disclosure

This game cannot be implemented fairly without FHE.

⸻

Game Rules (MVP)

This project intentionally keeps the rules minimal.
	•	Players: 5 (fixed)
	•	Roles:
	•	🐺 Werewolf: 1
	•	👤 Villagers: 4
	•	Phases:
	1.	Role assignment (encrypted)
	2.	Voting (encrypted)
	3.	Result reveal (public)
	•	Win conditions:
	•	Werewolf is eliminated → Villagers win
	•	Otherwise → Werewolf wins

Out of Scope (by design)
	•	Night phase
	•	Special abilities
	•	Real-time sync
	•	Anti-cheat / identity verification
	•	UI polish

⸻

What Is Encrypted vs Public

Data	Encrypted (FHE)	Public
Player roles	✅	❌
Individual votes	✅	❌
Vote counts	✅	❌
Eliminated player	❌	✅
Final outcome	❌	✅


⸻

Architecture

Player (Browser / CLI)
 └─ Encrypt role / vote
        ↓
Zama Relayer SDK
        ↓
FHE Werewolf Contract
        ↓
Encrypted computation
        ↓
Public result only

	•	No backend server
	•	No trusted operator
	•	No privileged account

⸻

Smart Contract Design

Core Data Structures
	•	ebool[5] roles
Encrypted roles (true = werewolf)
	•	euint8[5] voteCounts
Encrypted vote tally per player

Public State
	•	uint8 eliminatedPlayer
	•	bool villagersWin
	•	bool gameEnded

⸻

Game Flow
	1.	Players join and select a player ID (0–4)
	2.	Each player submits their encrypted role
	3.	Each player submits one encrypted vote
	4.	Anyone calls finalizeGame()
	5.	The contract reveals:
	•	Eliminated player
	•	Winning side

At no point are roles or votes revealed.

⸻

Security Model
	•	No administrator privileges
	•	No role inspection
	•	No vote inspection
	•	Only final boolean results are decrypted

This ensures trust minimization by design.

⸻

Tech Stack
	•	Solidity (Zama FHEVM)
	•	Zama Relayer SDK (JavaScript)
	•	Hardhat
	•	ethers / viem

⸻

Demo (Example CLI Flow)

# Submit role
node relayer.js role 0 villager
node relayer.js role 1 werewolf

# Submit votes
node relayer.js vote 0 2
node relayer.js vote 1 2
node relayer.js vote 2 1
node relayer.js vote 3 2
node relayer.js vote 4 2

# Finalize and view result
node relayer.js result


⸻

Limitations

This is a proof-of-concept focused on FHE correctness and fairness.

It does not address:
	•	Player authentication
	•	Network-level anonymity
	•	Advanced game mechanics

These are intentionally excluded to keep the cryptographic core clear.

⸻

Conclusion

FHE Werewolf demonstrates how Fully Homomorphic Encryption enables trustless hidden-information games.

No player, server, or operator ever sees private roles or votes —
yet the game completes correctly and verifiably.

⸻
