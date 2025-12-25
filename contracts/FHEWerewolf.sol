// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, ebool, euint8, externalEuint8} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract FHEWerewolf is ZamaEthereumConfig {
    enum Phase {
        Join,
        VoteRound1,
        WaitingTieReveal,
        VoteRound2,
        Finalizing,
        Revealed
    }

    uint8 public constant PLAYER_COUNT = 5;

    Phase public phase;
    uint8 public voteRound;
    bool public gameEnded;

    // Public final outcome (set only after revealResult)
    uint8 public eliminatedPlayer;
    bool public villagersWin;

    // Player registry
    address[PLAYER_COUNT] public players;
    bool[PLAYER_COUNT] public joined;
    bool[PLAYER_COUNT] public voted;
    uint8 public joinedCount;

    // Address -> playerId mapping (0-4). Presence tracked separately.
    mapping(address => uint8) private playerIdByAddress;
    mapping(address => bool) private isPlayer;

    // Confidential state
    ebool[PLAYER_COUNT] private roles; // true = werewolf
    euint8[PLAYER_COUNT] private voteCounts;

    // Round1 tie flag (publicly decryptable; used to branch to round2)
    ebool private isTieEnc;

    // Final results (publicly decryptable; then verified onchain and written as cleartext)
    euint8 private eliminatedIndexEnc;
    ebool private villagersWinEnc;

    event Joined(address indexed player, uint8 indexed playerId);
    event GameStarted(bytes32 wolfIndexHandle);
    event VoteSubmitted(address indexed player, uint8 indexed playerId, uint8 indexed round);
    event Round1Finalized(bytes32 isTieHandle);
    event TieRevealed(bool isTie);
    event Round2Started();
    event Finalizing(bytes32 eliminatedIndexHandle, bytes32 villagersWinHandle);
    event ResultRevealed(uint8 eliminatedPlayer, bool villagersWin);

    error InvalidPhase();
    error InvalidPlayerId();
    error SlotTaken();
    error AlreadyJoined();
    error NotAPlayer();
    error NotPlayerForId();
    error AlreadyVoted();
    error NotAllVoted();
    error InvalidHandles();

    constructor() {
        phase = Phase.Join;
        voteRound = 0;
        eliminatedPlayer = 255;
    }

    // ----------------------
    // Views
    // ----------------------

    function getMyPlayerId() external view returns (uint8) {
        if (!isPlayer[msg.sender]) revert NotAPlayer();
        return playerIdByAddress[msg.sender];
    }

    /// @notice Returns the encrypted role handle for the caller.
    /// @dev The caller can userDecrypt it because the contract grants ACL to the caller at game start.
    function getMyRoleHandle() external view returns (ebool) {
        if (!isPlayer[msg.sender]) revert NotAPlayer();
        uint8 playerId = playerIdByAddress[msg.sender];
        return roles[playerId];
    }

    // ----------------------
    // Gameplay
    // ----------------------

    function join(uint8 playerId) external {
        if (phase != Phase.Join) revert InvalidPhase();
        if (playerId >= PLAYER_COUNT) revert InvalidPlayerId();
        if (isPlayer[msg.sender]) revert AlreadyJoined();
        if (joined[playerId]) revert SlotTaken();

        players[playerId] = msg.sender;
        joined[playerId] = true;
        isPlayer[msg.sender] = true;
        playerIdByAddress[msg.sender] = playerId;
        joinedCount += 1;

        emit Joined(msg.sender, playerId);

        if (joinedCount == PLAYER_COUNT) {
            _startGame();
        }
    }

    function submitVote(uint8 playerId, externalEuint8 voteExt, bytes calldata inputProof) external {
        if (phase != Phase.VoteRound1 && phase != Phase.VoteRound2) revert InvalidPhase();
        if (playerId >= PLAYER_COUNT) revert InvalidPlayerId();
        if (!joined[playerId]) revert NotAPlayer();
        if (players[playerId] != msg.sender) revert NotPlayerForId();
        if (voted[playerId]) revert AlreadyVoted();

        euint8 vote = FHE.fromExternal(voteExt, inputProof);

        // validVote = (vote < 5)
        ebool validVote = FHE.lt(vote, FHE.asEuint8(PLAYER_COUNT));

        // For each candidate i, add 1 iff validVote && (vote == i)
        for (uint8 i = 0; i < PLAYER_COUNT; i++) {
            ebool isTarget = FHE.eq(vote, FHE.asEuint8(i));
            ebool shouldInc = FHE.and(validVote, isTarget);
            euint8 inc = FHE.select(shouldInc, FHE.asEuint8(1), FHE.asEuint8(0));
            voteCounts[i] = FHE.add(voteCounts[i], inc);
            FHE.allowThis(voteCounts[i]);
        }

        voted[playerId] = true;

        emit VoteSubmitted(msg.sender, playerId, voteRound);
    }

    function finalizeGame() external {
        if (phase == Phase.VoteRound1) {
            _requireAllVoted();

            (euint8 winnerIndex, euint8 maxCount) = _argmaxVoteCounts();
            eliminatedIndexEnc = winnerIndex;
            FHE.allowThis(eliminatedIndexEnc);

            isTieEnc = _isTie(maxCount);
            FHE.allowThis(isTieEnc);
            FHE.makePubliclyDecryptable(isTieEnc);

            phase = Phase.WaitingTieReveal;
            emit Round1Finalized(FHE.toBytes32(isTieEnc));
            return;
        }

        if (phase == Phase.VoteRound2) {
            _requireAllVoted();

            (euint8 winnerIndex, ) = _argmaxVoteCounts();
            eliminatedIndexEnc = winnerIndex;
            FHE.allowThis(eliminatedIndexEnc);

            villagersWinEnc = _computeVillagersWin(eliminatedIndexEnc);
            FHE.allowThis(villagersWinEnc);

            FHE.makePubliclyDecryptable(eliminatedIndexEnc);
            FHE.makePubliclyDecryptable(villagersWinEnc);

            phase = Phase.Finalizing;
            emit Finalizing(FHE.toBytes32(eliminatedIndexEnc), FHE.toBytes32(villagersWinEnc));
            return;
        }

        revert InvalidPhase();
    }

    /// @notice Callback to reveal whether round1 ended in a tie.
    /// @dev Requires onchain verification of KMS signatures.
    function revealTie(
        bytes calldata abiEncodedCleartexts,
        bytes calldata decryptionProof,
        bytes32[] calldata handlesList
    ) external {
        if (phase != Phase.WaitingTieReveal) revert InvalidPhase();

        if (handlesList.length != 1 || handlesList[0] != FHE.toBytes32(isTieEnc)) revert InvalidHandles();

        // Verifies KMS signatures for the provided handle and cleartexts.
        FHE.checkSignatures(handlesList, abiEncodedCleartexts, decryptionProof);

        bool isTie = abi.decode(abiEncodedCleartexts, (bool));
        emit TieRevealed(isTie);

        if (!isTie) {
            // No tie: compute final win condition from round1 eliminated index
            villagersWinEnc = _computeVillagersWin(eliminatedIndexEnc);
            FHE.allowThis(villagersWinEnc);

            FHE.makePubliclyDecryptable(eliminatedIndexEnc);
            FHE.makePubliclyDecryptable(villagersWinEnc);

            phase = Phase.Finalizing;
            emit Finalizing(FHE.toBytes32(eliminatedIndexEnc), FHE.toBytes32(villagersWinEnc));
        } else {
            // Tie: reset for round2
            _resetVotes();
            voteRound = 2;
            phase = Phase.VoteRound2;
            emit Round2Started();
        }
    }

    /// @notice Callback to reveal final public result and persist it on-chain.
    /// @dev Requires onchain verification of KMS signatures.
    function revealResult(
        bytes calldata abiEncodedCleartexts,
        bytes calldata decryptionProof,
        bytes32[] calldata handlesList
    ) external {
        if (phase != Phase.Finalizing) revert InvalidPhase();
        if (gameEnded) revert InvalidPhase();

        if (handlesList.length != 2) revert InvalidHandles();
        if (handlesList[0] != FHE.toBytes32(eliminatedIndexEnc)) revert InvalidHandles();
        if (handlesList[1] != FHE.toBytes32(villagersWinEnc)) revert InvalidHandles();

        FHE.checkSignatures(handlesList, abiEncodedCleartexts, decryptionProof);

        // Public decrypt ABI encoding uses uint256 for euint* types.
        (uint256 eliminatedPlayerRaw, bool villagersWin_) = abi.decode(abiEncodedCleartexts, (uint256, bool));
        if (eliminatedPlayerRaw >= PLAYER_COUNT) revert InvalidPlayerId();

        eliminatedPlayer = uint8(eliminatedPlayerRaw);
        villagersWin = villagersWin_;
        gameEnded = true;
        phase = Phase.Revealed;

        emit ResultRevealed(eliminatedPlayer, villagersWin_);
    }

    // ----------------------
    // Internal helpers
    // ----------------------

    function _startGame() internal {
        // reset votes for round1
        _resetVotes();
        voteRound = 1;

        // Choose one werewolf index in [0,5)
        // Note: randEuint8 upperBound must be a power of 2; we use 8 then reduce modulo 5.
        euint8 r = FHE.randEuint8(8);
        euint8 wolfIdx = FHE.rem(r, PLAYER_COUNT);

        // Assign roles[i] = (wolfIdx == i)
        for (uint8 i = 0; i < PLAYER_COUNT; i++) {
            roles[i] = FHE.eq(wolfIdx, FHE.asEuint8(i));
            FHE.allowThis(roles[i]);
            // Allow the player to userDecrypt their own role
            FHE.allow(roles[i], players[i]);
        }

        phase = Phase.VoteRound1;
        emit GameStarted(FHE.toBytes32(wolfIdx));
    }

    function _resetVotes() internal {
        for (uint8 i = 0; i < PLAYER_COUNT; i++) {
            voted[i] = false;
            voteCounts[i] = FHE.asEuint8(0);
            FHE.allowThis(voteCounts[i]);
        }
    }

    function _requireAllVoted() internal view {
        for (uint8 i = 0; i < PLAYER_COUNT; i++) {
            if (!voted[i]) revert NotAllVoted();
        }
    }

    function _argmaxVoteCounts() internal returns (euint8 winnerIndex, euint8 maxCount) {
        // Deterministic tie-breaking: keep the smallest index when counts are equal.
        winnerIndex = FHE.asEuint8(0);
        maxCount = voteCounts[0];

        for (uint8 i = 1; i < PLAYER_COUNT; i++) {
            ebool gt = FHE.gt(voteCounts[i], maxCount);
            maxCount = FHE.select(gt, voteCounts[i], maxCount);
            winnerIndex = FHE.select(gt, FHE.asEuint8(i), winnerIndex);
        }

        FHE.allowThis(maxCount);
        FHE.allowThis(winnerIndex);
    }

    function _isTie(euint8 maxCount) internal returns (ebool) {
        // count how many candidates have count == maxCount
        euint8 eqCount = FHE.asEuint8(0);
        for (uint8 i = 0; i < PLAYER_COUNT; i++) {
            ebool eq = FHE.eq(voteCounts[i], maxCount);
            euint8 addOne = FHE.select(eq, FHE.asEuint8(1), FHE.asEuint8(0));
            eqCount = FHE.add(eqCount, addOne);
        }
        // tie if eqCount > 1
        ebool tie = FHE.gt(eqCount, FHE.asEuint8(1));
        FHE.allowThis(eqCount);
        FHE.allowThis(tie);
        return tie;
    }

    function _computeVillagersWin(euint8 eliminatedIdx) internal returns (ebool) {
        // wolfEliminated = OR_i( roles[i] AND (eliminatedIdx == i) )
        ebool wolfEliminated = FHE.asEbool(false);
        for (uint8 i = 0; i < PLAYER_COUNT; i++) {
            ebool isElim = FHE.eq(eliminatedIdx, FHE.asEuint8(i));
            ebool elimAndWolf = FHE.and(roles[i], isElim);
            wolfEliminated = FHE.or(wolfEliminated, elimAndWolf);
        }
        FHE.allowThis(wolfEliminated);
        return wolfEliminated;
    }
}
