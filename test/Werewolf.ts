import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FHEWerewolf, FHEWerewolf__factory } from "../types";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  carol: HardhatEthersSigner;
  dave: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory("FHEWerewolf")) as FHEWerewolf__factory;
  const contract = (await factory.deploy()) as FHEWerewolf;
  const contractAddress = await contract.getAddress();
  return { contract, contractAddress };
}

async function encryptVote(contractAddress: string, signer: HardhatEthersSigner, clearValue: number) {
  return await fhevm.createEncryptedInput(contractAddress, signer.address).add8(clearValue).encrypt();
}

function findEventArgs<T extends object>(receipt: any, contract: FHEWerewolf, eventName: string): T {
  for (const log of receipt.logs ?? []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === eventName) {
        return parsed.args as unknown as T;
      }
    } catch {
      // ignore logs from other contracts
    }
  }
  throw new Error(`Event '${eventName}' not found in receipt`);
}

async function joinAll(contract: FHEWerewolf, signers: Signers) {
  await (await contract.connect(signers.alice).join(0)).wait();
  await (await contract.connect(signers.bob).join(1)).wait();
  await (await contract.connect(signers.carol).join(2)).wait();
  await (await contract.connect(signers.dave).join(3)).wait();
  await (await contract.connect(signers.deployer).join(4)).wait();
}

function tamperHexData(hexData: string): string {
  if (!hexData.startsWith("0x") || hexData.length < 4) {
    throw new Error("Expected 0x-prefixed hex string");
  }
  const lastByte = hexData.slice(-2);
  const flipped = lastByte === "00" ? "01" : "00";
  return hexData.slice(0, -2) + flipped;
}

describe("FHEWerewolf", function () {
  let signers: Signers;
  let contract: FHEWerewolf;
  let contractAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = {
      deployer: ethSigners[0],
      alice: ethSigners[1],
      bob: ethSigners[2],
      carol: ethSigners[3],
      dave: ethSigners[4],
    };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }

    ({ contract, contractAddress } = await deployFixture());
  });

  it("deploys with expected initial state", async function () {
    expect(await contract.phase()).to.eq(0n); // Join
    expect(await contract.voteRound()).to.eq(0n);
    expect(await contract.gameEnded()).to.eq(false);
    expect(await contract.eliminatedPlayer()).to.eq(255n);
  });

  it("join: assigns player slots and auto-starts at 5", async function () {
    await joinAll(contract, signers);

    expect(await contract.joinedCount()).to.eq(5n);
    expect(await contract.voteRound()).to.eq(1n);
    expect(await contract.phase()).to.eq(1n); // VoteRound1
  });

  it("join: rejects out-of-range playerId, duplicate join, and join after start", async function () {
    await expect(contract.connect(signers.alice).join(5)).to.be.reverted;

    await (await contract.connect(signers.alice).join(0)).wait();
    await expect(contract.connect(signers.bob).join(0)).to.be.reverted;
    await expect(contract.connect(signers.alice).join(1)).to.be.reverted;

    await (await contract.connect(signers.bob).join(1)).wait();
    await (await contract.connect(signers.carol).join(2)).wait();
    await (await contract.connect(signers.dave).join(3)).wait();
    await (await contract.connect(signers.deployer).join(4)).wait();

    expect(await contract.phase()).to.eq(1n); // VoteRound1
    await expect(contract.connect(signers.alice).join(2)).to.be.reverted;
  });

  it("role: each player can userDecrypt their role; exactly one werewolf", async function () {
    await joinAll(contract, signers);

    const roleHandles = [
      await contract.connect(signers.alice).getMyRoleHandle(),
      await contract.connect(signers.bob).getMyRoleHandle(),
      await contract.connect(signers.carol).getMyRoleHandle(),
      await contract.connect(signers.dave).getMyRoleHandle(),
      await contract.connect(signers.deployer).getMyRoleHandle(),
    ];

    // In the mock environment, run decrypts sequentially to avoid log cursor ordering issues.
    const rolesClear: boolean[] = [];
    rolesClear.push(await fhevm.userDecryptEbool(roleHandles[0], contractAddress, signers.alice));
    rolesClear.push(await fhevm.userDecryptEbool(roleHandles[1], contractAddress, signers.bob));
    rolesClear.push(await fhevm.userDecryptEbool(roleHandles[2], contractAddress, signers.carol));
    rolesClear.push(await fhevm.userDecryptEbool(roleHandles[3], contractAddress, signers.dave));
    rolesClear.push(await fhevm.userDecryptEbool(roleHandles[4], contractAddress, signers.deployer));

    const werewolves = rolesClear.filter((v) => v).length;
    expect(werewolves).to.eq(1);
  });

  it("vote: only the registered address for playerId can vote", async function () {
    await joinAll(contract, signers);

    const enc = await encryptVote(contractAddress, signers.alice, 0);
    await expect(contract.connect(signers.alice).submitVote(1, enc.handles[0], enc.inputProof)).to.be.reverted;
  });

  it("vote: rejects not-joined playerId, duplicate vote in same round, and wrong phase", async function () {
    await joinAll(contract, signers);

    const enc0 = await encryptVote(contractAddress, signers.alice, 0);
    await expect(contract.connect(signers.alice).submitVote(9, enc0.handles[0], enc0.inputProof)).to.be.reverted;

    await (await contract.connect(signers.alice).submitVote(0, enc0.handles[0], enc0.inputProof)).wait();
    const encAgain = await encryptVote(contractAddress, signers.alice, 1);
    await expect(contract.connect(signers.alice).submitVote(0, encAgain.handles[0], encAgain.inputProof)).to.be.reverted;

    const eb = await encryptVote(contractAddress, signers.bob, 0);
    const ec = await encryptVote(contractAddress, signers.carol, 0);
    const ed = await encryptVote(contractAddress, signers.dave, 0);
    const ee = await encryptVote(contractAddress, signers.deployer, 0);

    await (await contract.connect(signers.bob).submitVote(1, eb.handles[0], eb.inputProof)).wait();
    await (await contract.connect(signers.carol).submitVote(2, ec.handles[0], ec.inputProof)).wait();
    await (await contract.connect(signers.dave).submitVote(3, ed.handles[0], ed.inputProof)).wait();
    await (await contract.connect(signers.deployer).submitVote(4, ee.handles[0], ee.inputProof)).wait();

    await (await contract.finalizeGame()).wait();
    expect(await contract.phase()).to.eq(2n); // WaitingTieReveal

    const encWrongPhase = await encryptVote(contractAddress, signers.bob, 0);
    await expect(contract.connect(signers.bob).submitVote(1, encWrongPhase.handles[0], encWrongPhase.inputProof)).to.be.reverted;
  });

  it("finalize: cannot finalize unless all players voted (round1)", async function () {
    await joinAll(contract, signers);

    const r1a = await encryptVote(contractAddress, signers.alice, 0);
    await (await contract.connect(signers.alice).submitVote(0, r1a.handles[0], r1a.inputProof)).wait();

    await expect(contract.finalizeGame()).to.be.reverted;
  });

  it("invalid vote values act as abstention (no extra count)", async function () {
    this.timeout(120_000);

    await joinAll(contract, signers);

    // 4 valid votes for 0, and 1 invalid vote (7). Result must still be 0.
    const v0a = await encryptVote(contractAddress, signers.alice, 0);
    const v0b = await encryptVote(contractAddress, signers.bob, 0);
    const v0c = await encryptVote(contractAddress, signers.carol, 0);
    const v0d = await encryptVote(contractAddress, signers.dave, 0);
    const invalid = await encryptVote(contractAddress, signers.deployer, 7);

    await (await contract.connect(signers.alice).submitVote(0, v0a.handles[0], v0a.inputProof)).wait();
    await (await contract.connect(signers.bob).submitVote(1, v0b.handles[0], v0b.inputProof)).wait();
    await (await contract.connect(signers.carol).submitVote(2, v0c.handles[0], v0c.inputProof)).wait();
    await (await contract.connect(signers.dave).submitVote(3, v0d.handles[0], v0d.inputProof)).wait();
    await (await contract.connect(signers.deployer).submitVote(4, invalid.handles[0], invalid.inputProof)).wait();

    const finalize1Receipt = await (await contract.finalizeGame()).wait();
    expect(await contract.phase()).to.eq(2n); // WaitingTieReveal

    const round1 = findEventArgs<{ isTieHandle: string }>(finalize1Receipt, contract, "Round1Finalized");
    const isTieHandleHex = ethers.hexlify(round1.isTieHandle);
    const tieDecrypt = await fhevm.publicDecrypt([isTieHandleHex]);

    // should be no tie (4 vs 0)
    const revealTieReceipt = await (
      await contract.revealTie(tieDecrypt.abiEncodedClearValues, tieDecrypt.decryptionProof, [round1.isTieHandle])
    ).wait();
    expect(await contract.phase()).to.eq(4n); // Finalizing

    const fin = findEventArgs<{ eliminatedIndexHandle: string; villagersWinHandle: string }>(
      revealTieReceipt,
      contract,
      "Finalizing",
    );

    const elimHandleHex = ethers.hexlify(fin.eliminatedIndexHandle);
    const winHandleHex = ethers.hexlify(fin.villagersWinHandle);
    const resultDecrypt = await fhevm.publicDecrypt([elimHandleHex, winHandleHex]);

    await (await contract.revealResult(
      resultDecrypt.abiEncodedClearValues,
      resultDecrypt.decryptionProof,
      [fin.eliminatedIndexHandle, fin.villagersWinHandle],
    )).wait();

    expect(await contract.eliminatedPlayer()).to.eq(0n);
  });

  it("round1 tie -> revealTie -> round2 -> revealResult persists final outcome", async function () {
    this.timeout(120_000);

    await joinAll(contract, signers);

    // Round1 votes (tie between 0 and 1)
    const r1a = await encryptVote(contractAddress, signers.alice, 0);
    const r1b = await encryptVote(contractAddress, signers.bob, 0);
    const r1c = await encryptVote(contractAddress, signers.carol, 1);
    const r1d = await encryptVote(contractAddress, signers.dave, 1);
    const r1e = await encryptVote(contractAddress, signers.deployer, 2);

    await (await contract.connect(signers.alice).submitVote(0, r1a.handles[0], r1a.inputProof)).wait();
    await (await contract.connect(signers.bob).submitVote(1, r1b.handles[0], r1b.inputProof)).wait();
    await (await contract.connect(signers.carol).submitVote(2, r1c.handles[0], r1c.inputProof)).wait();
    await (await contract.connect(signers.dave).submitVote(3, r1d.handles[0], r1d.inputProof)).wait();
    await (await contract.connect(signers.deployer).submitVote(4, r1e.handles[0], r1e.inputProof)).wait();

    const finalize1 = await (await contract.finalizeGame()).wait();
    expect(await contract.phase()).to.eq(2n); // WaitingTieReveal

    const round1 = findEventArgs<{ isTieHandle: string }>(finalize1, contract, "Round1Finalized");
    const isTieHandleHex = ethers.hexlify(round1.isTieHandle);
    const tieDecrypt = await fhevm.publicDecrypt([isTieHandleHex]);

    const revealTieTx = await contract.revealTie(
      tieDecrypt.abiEncodedClearValues,
      tieDecrypt.decryptionProof,
      [round1.isTieHandle],
    );
    await revealTieTx.wait();

    expect(await contract.phase()).to.eq(3n); // VoteRound2
    expect(await contract.voteRound()).to.eq(2n);

    // Round2 votes (no tie): 3 votes for 0, 2 votes for 1
    const v0a = await encryptVote(contractAddress, signers.alice, 0);
    const v0b = await encryptVote(contractAddress, signers.bob, 0);
    const v0c = await encryptVote(contractAddress, signers.carol, 0);
    const v1d = await encryptVote(contractAddress, signers.dave, 1);
    const v1e = await encryptVote(contractAddress, signers.deployer, 1);

    await (await contract.connect(signers.alice).submitVote(0, v0a.handles[0], v0a.inputProof)).wait();
    await (await contract.connect(signers.bob).submitVote(1, v0b.handles[0], v0b.inputProof)).wait();
    await (await contract.connect(signers.carol).submitVote(2, v0c.handles[0], v0c.inputProof)).wait();
    await (await contract.connect(signers.dave).submitVote(3, v1d.handles[0], v1d.inputProof)).wait();
    await (await contract.connect(signers.deployer).submitVote(4, v1e.handles[0], v1e.inputProof)).wait();

    const finalize2Receipt = await (await contract.finalizeGame()).wait();
    expect(await contract.phase()).to.eq(4n); // Finalizing

    const fin = findEventArgs<{ eliminatedIndexHandle: string; villagersWinHandle: string }>(
      finalize2Receipt,
      contract,
      "Finalizing",
    );

    const elimHandleHex = ethers.hexlify(fin.eliminatedIndexHandle);
    const winHandleHex = ethers.hexlify(fin.villagersWinHandle);
    const resultDecrypt = await fhevm.publicDecrypt([elimHandleHex, winHandleHex]);

    await (await contract.revealResult(
      resultDecrypt.abiEncodedClearValues,
      resultDecrypt.decryptionProof,
      [fin.eliminatedIndexHandle, fin.villagersWinHandle],
    )).wait();

    expect(await contract.phase()).to.eq(5n); // Revealed
    expect(await contract.gameEnded()).to.eq(true);
    expect(await contract.eliminatedPlayer()).to.eq(0n);
    // villagersWin is random depending on who was werewolf; just assert it's boolean-ish
    expect(typeof (await contract.villagersWin())).to.eq("boolean");
  });

  it("revealTie/revealResult: tampered cleartext fails signature verification", async function () {
    this.timeout(120_000);

    await joinAll(contract, signers);

    // Create a tie in round1
    const r1a = await encryptVote(contractAddress, signers.alice, 0);
    const r1b = await encryptVote(contractAddress, signers.bob, 0);
    const r1c = await encryptVote(contractAddress, signers.carol, 1);
    const r1d = await encryptVote(contractAddress, signers.dave, 1);
    const r1e = await encryptVote(contractAddress, signers.deployer, 2);

    await (await contract.connect(signers.alice).submitVote(0, r1a.handles[0], r1a.inputProof)).wait();
    await (await contract.connect(signers.bob).submitVote(1, r1b.handles[0], r1b.inputProof)).wait();
    await (await contract.connect(signers.carol).submitVote(2, r1c.handles[0], r1c.inputProof)).wait();
    await (await contract.connect(signers.dave).submitVote(3, r1d.handles[0], r1d.inputProof)).wait();
    await (await contract.connect(signers.deployer).submitVote(4, r1e.handles[0], r1e.inputProof)).wait();

    const finalize1Receipt = await (await contract.finalizeGame()).wait();
    const round1 = findEventArgs<{ isTieHandle: string }>(finalize1Receipt, contract, "Round1Finalized");
    const isTieHandleHex = ethers.hexlify(round1.isTieHandle);
    const tieDecrypt = await fhevm.publicDecrypt([isTieHandleHex]);

    await expect(
      contract.revealTie(tamperHexData(tieDecrypt.abiEncodedClearValues), tieDecrypt.decryptionProof, [round1.isTieHandle]),
    ).to.be.reverted;

    // Use the correct tie reveal to continue
    await (await contract.revealTie(tieDecrypt.abiEncodedClearValues, tieDecrypt.decryptionProof, [round1.isTieHandle])).wait();
    expect(await contract.phase()).to.eq(3n); // VoteRound2

    // Round2: no tie
    const v0a = await encryptVote(contractAddress, signers.alice, 0);
    const v0b = await encryptVote(contractAddress, signers.bob, 0);
    const v0c = await encryptVote(contractAddress, signers.carol, 0);
    const v1d = await encryptVote(contractAddress, signers.dave, 1);
    const v1e = await encryptVote(contractAddress, signers.deployer, 1);

    await (await contract.connect(signers.alice).submitVote(0, v0a.handles[0], v0a.inputProof)).wait();
    await (await contract.connect(signers.bob).submitVote(1, v0b.handles[0], v0b.inputProof)).wait();
    await (await contract.connect(signers.carol).submitVote(2, v0c.handles[0], v0c.inputProof)).wait();
    await (await contract.connect(signers.dave).submitVote(3, v1d.handles[0], v1d.inputProof)).wait();
    await (await contract.connect(signers.deployer).submitVote(4, v1e.handles[0], v1e.inputProof)).wait();

    const finalize2Receipt = await (await contract.finalizeGame()).wait();
    const fin = findEventArgs<{ eliminatedIndexHandle: string; villagersWinHandle: string }>(
      finalize2Receipt,
      contract,
      "Finalizing",
    );

    const elimHandleHex = ethers.hexlify(fin.eliminatedIndexHandle);
    const winHandleHex = ethers.hexlify(fin.villagersWinHandle);
    const resultDecrypt = await fhevm.publicDecrypt([elimHandleHex, winHandleHex]);

    await expect(
      contract.revealResult(
        tamperHexData(resultDecrypt.abiEncodedClearValues),
        resultDecrypt.decryptionProof,
        [fin.eliminatedIndexHandle, fin.villagersWinHandle],
      ),
    ).to.be.reverted;
  });

  it("revealResult: cannot be called twice", async function () {
    this.timeout(120_000);

    await joinAll(contract, signers);

    // Round1 tie -> Round2 -> Finalizing
    const r1a = await encryptVote(contractAddress, signers.alice, 0);
    const r1b = await encryptVote(contractAddress, signers.bob, 0);
    const r1c = await encryptVote(contractAddress, signers.carol, 1);
    const r1d = await encryptVote(contractAddress, signers.dave, 1);
    const r1e = await encryptVote(contractAddress, signers.deployer, 2);

    await (await contract.connect(signers.alice).submitVote(0, r1a.handles[0], r1a.inputProof)).wait();
    await (await contract.connect(signers.bob).submitVote(1, r1b.handles[0], r1b.inputProof)).wait();
    await (await contract.connect(signers.carol).submitVote(2, r1c.handles[0], r1c.inputProof)).wait();
    await (await contract.connect(signers.dave).submitVote(3, r1d.handles[0], r1d.inputProof)).wait();
    await (await contract.connect(signers.deployer).submitVote(4, r1e.handles[0], r1e.inputProof)).wait();

    const finalize1Receipt = await (await contract.finalizeGame()).wait();
    const round1 = findEventArgs<{ isTieHandle: string }>(finalize1Receipt, contract, "Round1Finalized");
    const tieDecrypt = await fhevm.publicDecrypt([ethers.hexlify(round1.isTieHandle)]);
    await (await contract.revealTie(tieDecrypt.abiEncodedClearValues, tieDecrypt.decryptionProof, [round1.isTieHandle])).wait();

    const v0a = await encryptVote(contractAddress, signers.alice, 0);
    const v0b = await encryptVote(contractAddress, signers.bob, 0);
    const v0c = await encryptVote(contractAddress, signers.carol, 0);
    const v1d = await encryptVote(contractAddress, signers.dave, 1);
    const v1e = await encryptVote(contractAddress, signers.deployer, 1);

    await (await contract.connect(signers.alice).submitVote(0, v0a.handles[0], v0a.inputProof)).wait();
    await (await contract.connect(signers.bob).submitVote(1, v0b.handles[0], v0b.inputProof)).wait();
    await (await contract.connect(signers.carol).submitVote(2, v0c.handles[0], v0c.inputProof)).wait();
    await (await contract.connect(signers.dave).submitVote(3, v1d.handles[0], v1d.inputProof)).wait();
    await (await contract.connect(signers.deployer).submitVote(4, v1e.handles[0], v1e.inputProof)).wait();

    const finalize2Receipt = await (await contract.finalizeGame()).wait();
    const fin = findEventArgs<{ eliminatedIndexHandle: string; villagersWinHandle: string }>(
      finalize2Receipt,
      contract,
      "Finalizing",
    );

    const resultDecrypt = await fhevm.publicDecrypt([
      ethers.hexlify(fin.eliminatedIndexHandle),
      ethers.hexlify(fin.villagersWinHandle),
    ]);

    await (await contract.revealResult(
      resultDecrypt.abiEncodedClearValues,
      resultDecrypt.decryptionProof,
      [fin.eliminatedIndexHandle, fin.villagersWinHandle],
    )).wait();

    await expect(
      contract.revealResult(
        resultDecrypt.abiEncodedClearValues,
        resultDecrypt.decryptionProof,
        [fin.eliminatedIndexHandle, fin.villagersWinHandle],
      ),
    ).to.be.reverted;
  });
});
