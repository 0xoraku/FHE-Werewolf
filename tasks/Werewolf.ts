import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";
import { FHEWerewolf, FHEWerewolf__factory } from "../types";

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
 * Join a slot.
 * Example:
 *  - npx hardhat --network localhost werewolf:join --address 0x... --playerId 0
 */
task("werewolf:join", "Join the game with a playerId (0-4)")
  .addOptionalParam("address", "FHEWerewolf contract address (defaults to deployments.get('FHEWerewolf'))")
  .addParam("playerId", "playerId 0-4")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { contract } = await resolveWerewolfContract(taskArguments, hre);
    const { ethers } = hre;

    const playerId = requireIntInRange(taskArguments.playerId, "playerId", 0, 4);
    const signers = await ethers.getSigners();

    const tx = await contract.connect(signers[0]).join(playerId);
    console.log(`Wait for tx:${tx.hash}...`);
    await tx.wait();

    console.log(`Joined playerId=${playerId} as ${signers[0].address}`);
    console.log(`phase=${await contract.phase()} voteRound=${await contract.voteRound()} joinedCount=${await contract.joinedCount()}`);
  });

/**
 * Decrypt your role (userDecrypt) after auto-start.
 * Example:
 *  - npx hardhat --network localhost werewolf:role --address 0x...
 */
task("werewolf:role", "Fetches encrypted role handle and userDecrypts it")
  .addOptionalParam("address", "FHEWerewolf contract address (defaults to deployments.get('FHEWerewolf'))")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { contract, address } = await resolveWerewolfContract(taskArguments, hre);
    const { ethers, fhevm } = hre;

    const signers = await ethers.getSigners();

    const handle = await contract.connect(signers[0]).getMyRoleHandle();
    console.log(`roleHandle=${handle}`);

    const clear = await fhevm.userDecryptEbool(handle, address, signers[0]);
    console.log(`role (clear): ${clear ? "werewolf" : "villager"}`);
  });

/**
 * Submit a vote.
 * Example:
 *  - npx hardhat --network localhost werewolf:vote --address 0x... --playerId 0 --vote 2
 */
task("werewolf:vote", "Encrypts a vote and submits it")
  .addOptionalParam("address", "FHEWerewolf contract address (defaults to deployments.get('FHEWerewolf'))")
  .addParam("playerId", "your playerId 0-4")
  .addParam("vote", "target playerId 0-4")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { contract, address } = await resolveWerewolfContract(taskArguments, hre);
    const { ethers, fhevm } = hre;

    const playerId = requireIntInRange(taskArguments.playerId, "playerId", 0, 4);
    const vote = requireIntInRange(taskArguments.vote, "vote", 0, 255);

    const signers = await ethers.getSigners();

    const encrypted = await fhevm.createEncryptedInput(address, signers[0].address).add8(vote).encrypt();

    const tx = await contract.connect(signers[0]).submitVote(playerId, encrypted.handles[0], encrypted.inputProof);
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
 *  - npx hardhat --network localhost werewolf:reveal-tie --address 0x... --isTieHandle 0x...
 */
task("werewolf:reveal-tie", "publicDecrypt isTieEnc and calls revealTie(...)")
  .addOptionalParam("address", "FHEWerewolf contract address (defaults to deployments.get('FHEWerewolf'))")
  .addParam("isTieHandle", "bytes32 handle emitted by Round1Finalized")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { contract } = await resolveWerewolfContract(taskArguments, hre);
    const { ethers, fhevm } = hre;

    const isTieHandle = taskArguments.isTieHandle as string;
    if (!ethers.isHexString(isTieHandle, 32)) {
      throw new Error("--isTieHandle must be a 32-byte hex string (bytes32)");
    }

    const decrypted = await fhevm.publicDecrypt([isTieHandle]);

    const tx = await contract.revealTie(decrypted.abiEncodedClearValues, decrypted.decryptionProof, [isTieHandle]);
    console.log(`Wait for tx:${tx.hash}...`);
    await tx.wait();

    console.log(`phase=${await contract.phase()} voteRound=${await contract.voteRound()}`);
  });

/**
 * Reveal final result by calling relayer publicDecrypt and submitting proof onchain.
 *
 * Example:
 *  - npx hardhat --network localhost werewolf:reveal-result --address 0x... --elimHandle 0x... --winHandle 0x...
 */
task("werewolf:reveal-result", "publicDecrypt final handles and calls revealResult(...)")
  .addOptionalParam("address", "FHEWerewolf contract address (defaults to deployments.get('FHEWerewolf'))")
  .addParam("elimHandle", "bytes32 handle for eliminatedIndexEnc")
  .addParam("winHandle", "bytes32 handle for villagersWinEnc")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { contract } = await resolveWerewolfContract(taskArguments, hre);
    const { ethers, fhevm } = hre;

    const elimHandle = taskArguments.elimHandle as string;
    const winHandle = taskArguments.winHandle as string;

    for (const [name, v] of [
      ["elimHandle", elimHandle],
      ["winHandle", winHandle],
    ] as const) {
      if (!ethers.isHexString(v, 32)) {
        throw new Error(`--${name} must be a 32-byte hex string (bytes32)`);
      }
    }

    const decrypted = await fhevm.publicDecrypt([elimHandle, winHandle]);

    const tx = await contract.revealResult(decrypted.abiEncodedClearValues, decrypted.decryptionProof, [elimHandle, winHandle]);
    console.log(`Wait for tx:${tx.hash}...`);
    await tx.wait();

    console.log(`phase=${await contract.phase()} gameEnded=${await contract.gameEnded()}`);
    console.log(`eliminatedPlayer=${await contract.eliminatedPlayer()} villagersWin=${await contract.villagersWin()}`);
  });
