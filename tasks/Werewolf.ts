import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";
import { FHEWerewolf, FHEWerewolf__factory } from "../types";

async function ensureFhevmCli(hre: any): Promise<void> {
  if (hre?.fhevm?.initializeCLIApi) {
    await hre.fhevm.initializeCLIApi();
  }
}

function requireIntInRange(value: unknown, name: string, min: number, max: number): number {
  const n = typeof value === "string" ? parseInt(value, 10) : Number(value);
  if (!Number.isInteger(n)) throw new Error(`${name} must be an integer`);
  if (n < min || n > max) throw new Error(`${name} must be in range [${min}, ${max}]`);
  return n;
}

async function resolveWerewolfContract(
  taskArguments: TaskArguments,
  hre: any,
): Promise<{ contract: FHEWerewolf; address: string }> {
  const { ethers, deployments } = hre;

  let address: string | undefined = taskArguments.address;
  if (!address) {
    try {
      const deployment = await deployments.get("FHEWerewolf");
      address = deployment.address;
    } catch (e) {
      throw new Error(
        "Missing --address and no deployments entry found for FHEWerewolf. Run `npx hardhat deploy` or pass --address 0x...",
      );
    }
  }

  if (!address) {
    throw new Error("Failed to resolve FHEWerewolf address");
  }

  const contract = (await ethers.getContractAt("FHEWerewolf", address)) as unknown as FHEWerewolf;
  return { contract, address };
}

function extractEventArgs<T extends object>(contract: FHEWerewolf, receipt: any, eventName: string): T {
  for (const log of receipt.logs ?? []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === eventName) return parsed.args as unknown as T;
    } catch {
      // ignore
    }
  }
  throw new Error(`Event '${eventName}' not found in tx receipt`);
}

/**
 * Deploy (without hardhat-deploy) and print address.
 * Example:
 *  - npx hardhat --network localhost werewolf:deploy
 */
task("werewolf:deploy", "Deploys the FHEWerewolf contract (simple ethers deploy)").setAction(async function (_args: TaskArguments, hre) {
  const { ethers } = hre;

  const factory = (await ethers.getContractFactory("FHEWerewolf")) as unknown as FHEWerewolf__factory;
  const contract = (await factory.deploy()) as unknown as FHEWerewolf;
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`FHEWerewolf deployed at ${address}`);
});

/**
 * One-command local demo (runs everything in a single process).
 * Example:
 *  - npx hardhat werewolf:demo
 */
task("werewolf:demo", "Runs a full local demo flow (deploy -> join -> vote -> finalize -> reveal)").setAction(
  async function (_args: TaskArguments, hre) {
    const { ethers, fhevm } = hre;

    await ensureFhevmCli(hre);

    if (!fhevm?.isMock) {
      throw new Error("werewolf:demo is intended for the local mock environment");
    }

    const signers = await ethers.getSigners();
    if (signers.length < 5) throw new Error("Need at least 5 local signers");

    const factory = (await ethers.getContractFactory("FHEWerewolf")) as unknown as FHEWerewolf__factory;
    const contract = (await factory.deploy()) as unknown as FHEWerewolf;
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    console.log(`FHEWerewolf deployed at ${address}`);

    // Join 0..4 with distinct signers
    for (let playerId = 0; playerId < 5; playerId++) {
      const tx = await contract.connect(signers[playerId]).join(playerId);
      await tx.wait();
      console.log(`Joined playerId=${playerId} as ${signers[playerId].address}`);
    }

    console.log(`phase=${await contract.phase()} voteRound=${await contract.voteRound()}`);

    // Votes: everyone votes 0 (no tie)
    for (let playerId = 0; playerId < 5; playerId++) {
      const encrypted = await fhevm.createEncryptedInput(address, signers[playerId].address).add8(0).encrypt();
      const tx = await contract.connect(signers[playerId]).submitVote(playerId, encrypted.handles[0], encrypted.inputProof);
      await tx.wait();
    }

    // Round1 finalize -> reveal tie
    const finalize1Receipt = await (await contract.finalizeGame()).wait();
    const round1 = extractEventArgs<{ isTieHandle: string }>(contract, finalize1Receipt, "Round1Finalized");
    const isTieHandleHex = ethers.hexlify(round1.isTieHandle);
    const tieDecrypt = await fhevm.publicDecrypt([isTieHandleHex]);

    const revealTieReceipt = await (
      await contract.revealTie(tieDecrypt.abiEncodedClearValues, tieDecrypt.decryptionProof, [round1.isTieHandle])
    ).wait();

    const fin = extractEventArgs<{ eliminatedIndexHandle: string; villagersWinHandle: string }>(
      contract,
      revealTieReceipt,
      "Finalizing",
    );

    const elimHandleHex = ethers.hexlify(fin.eliminatedIndexHandle);
    const winHandleHex = ethers.hexlify(fin.villagersWinHandle);
    const resultDecrypt = await fhevm.publicDecrypt([elimHandleHex, winHandleHex]);

    await (
      await contract.revealResult(
        resultDecrypt.abiEncodedClearValues,
        resultDecrypt.decryptionProof,
        [fin.eliminatedIndexHandle, fin.villagersWinHandle],
      )
    ).wait();

    console.log(`phase=${await contract.phase()} gameEnded=${await contract.gameEnded()}`);
    console.log(`eliminatedPlayer=${await contract.eliminatedPlayer()} villagersWin=${await contract.villagersWin()}`);
  },
);

/**
 * Join a slot.
 * Example:
 *  - npx hardhat --network localhost werewolf:join --address 0x... --playerid 0
 */
task("werewolf:join", "Join the game with a playerId (0-4)")
  .addOptionalParam("address", "FHEWerewolf contract address (defaults to deployments.get('FHEWerewolf'))")
  .addParam("playerid", "playerId 0-4")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { contract } = await resolveWerewolfContract(taskArguments, hre);
    const { ethers } = hre;

    const playerId = requireIntInRange(taskArguments.playerid, "playerId", 0, 4);
    const signers = await ethers.getSigners();

    const signer = signers[playerId];
    if (!signer) throw new Error(`No signer available for playerId=${playerId}`);

    const tx = await contract.connect(signer).join(playerId);
    console.log(`Wait for tx:${tx.hash}...`);
    await tx.wait();

    console.log(`Joined playerId=${playerId} as ${signer.address}`);
    console.log(`phase=${await contract.phase()} voteRound=${await contract.voteRound()} joinedCount=${await contract.joinedCount()}`);
  });

/**
 * Decrypt your role (userDecrypt) after auto-start.
 * Example:
 *  - npx hardhat --network localhost werewolf:role --address 0x...
 */
task("werewolf:role", "Fetches encrypted role handle and userDecrypts it")
  .addOptionalParam("address", "FHEWerewolf contract address (defaults to deployments.get('FHEWerewolf'))")
  .addOptionalParam("playerid", "playerId 0-4 (uses signers[playerId])")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { contract, address } = await resolveWerewolfContract(taskArguments, hre);
    const { ethers, fhevm } = hre;

    await ensureFhevmCli(hre);

    const signers = await ethers.getSigners();

    const playerIdRaw = taskArguments.playerid as string | undefined;
    const playerId = playerIdRaw === undefined ? 0 : requireIntInRange(playerIdRaw, "playerId", 0, 4);
    const signer = signers[playerId];
    if (!signer) throw new Error(`No signer available for playerId=${playerId}`);

    const handle = await contract.connect(signer).getMyRoleHandle();
    console.log(`roleHandle=${handle}`);

    const clear = await fhevm.userDecryptEbool(handle, address, signer);
    console.log(`role (clear): ${clear ? "werewolf" : "villager"}`);
  });

/**
 * Submit a vote.
 * Example:
 *  - npx hardhat --network localhost werewolf:vote --address 0x... --playerid 0 --vote 2
 */
task("werewolf:vote", "Encrypts a vote and submits it")
  .addOptionalParam("address", "FHEWerewolf contract address (defaults to deployments.get('FHEWerewolf'))")
  .addParam("playerid", "your playerId 0-4")
  .addParam("vote", "target playerId 0-4")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { contract, address } = await resolveWerewolfContract(taskArguments, hre);
    const { ethers, fhevm } = hre;

    await ensureFhevmCli(hre);

    const playerId = requireIntInRange(taskArguments.playerid, "playerId", 0, 4);
    const vote = requireIntInRange(taskArguments.vote, "vote", 0, 255);

    const signers = await ethers.getSigners();

    const signer = signers[playerId];
    if (!signer) throw new Error(`No signer available for playerId=${playerId}`);

    const encrypted = await fhevm.createEncryptedInput(address, signer.address).add8(vote).encrypt();

    const tx = await contract.connect(signer).submitVote(playerId, encrypted.handles[0], encrypted.inputProof);
    console.log(`Wait for tx:${tx.hash}...`);
    await tx.wait();

    console.log(`Voted: playerId=${playerId} -> vote=${vote}`);
    console.log(`phase=${await contract.phase()} voteRound=${await contract.voteRound()}`);
  });

/**
 * Finalize current round.
 * For round1, emits Round1Finalized(isTieHandle) and moves to WaitingTieReveal.
 * For round2, emits Finalizing(eliminatedIndexHandle, villagersWinHandle) and moves to Finalizing.
 *
 * Example:
 *  - npx hardhat --network localhost werewolf:finalize --address 0x...
 */
task("werewolf:finalize", "Calls finalizeGame()")
  .addOptionalParam("address", "FHEWerewolf contract address (defaults to deployments.get('FHEWerewolf'))")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { contract } = await resolveWerewolfContract(taskArguments, hre);
    const { ethers } = hre;

    const signers = await ethers.getSigners();

    const tx = await contract.connect(signers[0]).finalizeGame();
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();

    console.log(`phase=${await contract.phase()} voteRound=${await contract.voteRound()}`);

    // Try to print emitted handles if present
    try {
      const e = extractEventArgs<{ isTieHandle: string }>(contract, receipt, "Round1Finalized");
      console.log(`Round1Finalized isTieHandle=${ethers.hexlify(e.isTieHandle)}`);
    } catch {
      // ignore
    }

    try {
      const e = extractEventArgs<{ eliminatedIndexHandle: string; villagersWinHandle: string }>(contract, receipt, "Finalizing");
      console.log(`Finalizing eliminatedIndexHandle=${ethers.hexlify(e.eliminatedIndexHandle)}`);
      console.log(`Finalizing villagersWinHandle=${ethers.hexlify(e.villagersWinHandle)}`);
    } catch {
      // ignore
    }
  });

/**
 * Reveal tie result (round1) by calling relayer publicDecrypt and submitting proof onchain.
 *
 * Example:
 *  - npx hardhat --network localhost werewolf:reveal-tie --address 0x... --istiehandle 0x...
 */
task("werewolf:reveal-tie", "publicDecrypt isTieEnc and calls revealTie(...)")
  .addOptionalParam("address", "FHEWerewolf contract address (defaults to deployments.get('FHEWerewolf'))")
  .addParam("istiehandle", "bytes32 handle emitted by Round1Finalized")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { contract } = await resolveWerewolfContract(taskArguments, hre);
    const { ethers, fhevm } = hre;

    await ensureFhevmCli(hre);

    const isTieHandle = taskArguments.istiehandle as string;
    if (!ethers.isHexString(isTieHandle, 32)) {
      throw new Error("--istiehandle must be a 32-byte hex string (bytes32)");
    }

    const decrypted = await fhevm.publicDecrypt([isTieHandle]);

    const tx = await contract.revealTie(decrypted.abiEncodedClearValues, decrypted.decryptionProof, [isTieHandle]);
    console.log(`Wait for tx:${tx.hash}...`);
    const receipt = await tx.wait();

    console.log(`phase=${await contract.phase()} voteRound=${await contract.voteRound()}`);

    // If isTie == false, revealTie emits Finalizing with result handles.
    try {
      const e = extractEventArgs<{ eliminatedIndexHandle: string; villagersWinHandle: string }>(contract, receipt, "Finalizing");
      console.log(`Finalizing eliminatedIndexHandle=${ethers.hexlify(e.eliminatedIndexHandle)}`);
      console.log(`Finalizing villagersWinHandle=${ethers.hexlify(e.villagersWinHandle)}`);
    } catch {
      // ignore
    }
  });

/**
 * Reveal final result by calling relayer publicDecrypt and submitting proof onchain.
 *
 * Example:
 *  - npx hardhat --network localhost werewolf:reveal-result --address 0x... --elimhandle 0x... --winhandle 0x...
 */
task("werewolf:reveal-result", "publicDecrypt final handles and calls revealResult(...)")
  .addOptionalParam("address", "FHEWerewolf contract address (defaults to deployments.get('FHEWerewolf'))")
  .addParam("elimhandle", "bytes32 handle for eliminatedIndexEnc")
  .addParam("winhandle", "bytes32 handle for villagersWinEnc")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { contract } = await resolveWerewolfContract(taskArguments, hre);
    const { ethers, fhevm } = hre;

    await ensureFhevmCli(hre);

    const elimHandle = taskArguments.elimhandle as string;
    const winHandle = taskArguments.winhandle as string;

    for (const [name, v] of [
      ["elimHandle", elimHandle],
      ["winHandle", winHandle],
    ] as const) {
      if (!ethers.isHexString(v, 32)) {
        throw new Error(`--${name.toLowerCase()} must be a 32-byte hex string (bytes32)`);
      }
    }

    const decrypted = await fhevm.publicDecrypt([elimHandle, winHandle]);

    const tx = await contract.revealResult(decrypted.abiEncodedClearValues, decrypted.decryptionProof, [elimHandle, winHandle]);
    console.log(`Wait for tx:${tx.hash}...`);
    await tx.wait();

    console.log(`phase=${await contract.phase()} gameEnded=${await contract.gameEnded()}`);
    console.log(`eliminatedPlayer=${await contract.eliminatedPlayer()} villagersWin=${await contract.villagersWin()}`);
  });
