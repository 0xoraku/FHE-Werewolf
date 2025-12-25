# FHE Werewolf

Sepolia 上で動く、FHE（Fully Homomorphic Encryption）を使った Werewolf（人狼）デモ dApp。

- Smart Contract: `contracts/FHEWerewolf.sol`
- Web UI: `apps/web`

## 必要要件

- Node.js 20+
- MetaMask（Sepolia）

## セットアップ

```bash
npm install
```

## Sepolia へデプロイ（Hardhat vars）

このリポジトリは Hardhat の `vars` を使います。

```bash
npx hardhat vars set MNEMONIC
npx hardhat vars set INFURA_API_KEY

# optional: verify
npx hardhat vars set ETHERSCAN_API_KEY
```

```bash
npm run compile
npx hardhat deploy --network sepolia --tags FHEWerewolf
```

（任意）verify

```bash
npx hardhat verify --network sepolia <CONTRACT_ADDRESS>
```

## Web UI（ローカル）

`apps/web/.env.local` を作ってコントラクトアドレスを入れます。

```bash
cd apps/web
cp .env.example .env.local
# VITE_WEREWOLF_ADDRESS を <CONTRACT_ADDRESS> に更新
npm i
npm run dev
```

## Vercel

- Vercel の Environment Variables に `VITE_WEREWOLF_ADDRESS=<CONTRACT_ADDRESS>` を追加

## Sepolia E2E 手順（審査用）

- [docs/sepolia-e2e.md](docs/sepolia-e2e.md)

## Tech

- FHEVM Solidity library + Hardhat plugin
