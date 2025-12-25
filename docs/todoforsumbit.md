
# 提出前チェックリスト（必須のみ・このファイルで完結）

※ ルールの根拠: [docs/competitionrule.md](competitionrule.md)

## A. 提出として成立（必須）

- [x] プロジェクト名/説明に **"Zama" を含めていない**（混乱防止ルール）
- [x] Smart Contract + Frontend の両方があり、デモ導線がある
- [x] ルートREADMEに「デプロイ手順」「Web起動手順」「必要環境」がある（審査者が迷わない）
- [ ] 提出フォームに貼る GitHub リポジトリURL が用意できている
- [ ] 動画は作らない（提出物に動画リンクを要求しない）

## B. Secrets / 環境変数（必須）

### Hardhat（Sepoliaデプロイ用）

このリポジトリは Hardhat の `vars` を基本にしつつ、`.env` でも動く（`hardhat.config.ts` が `.env` を読む）。

- [ ] `MNEMONIC` を設定済み（どちらか）
  - [ ] `npx hardhat vars set MNEMONIC`
  - [ ] ルートの `.env` に `MNEMONIC=...`
- [ ] `INFURA_API_KEY` を設定済み（どちらか）
  - [ ] `npx hardhat vars set INFURA_API_KEY`
  - [ ] ルートの `.env` に `INFURA_API_KEY=...`
- [ ] （Infura以外を使う場合）`SEPOLIA_RPC_URL` を設定済み（どちらか）
  - [ ] `npx hardhat vars set SEPOLIA_RPC_URL`
  - [ ] ルートの `.env` に `SEPOLIA_RPC_URL=...`
- [ ] デプロイに使うアカウントに Sepolia ETH が入っている

### Web（Vite / Vercel用。公開情報のみ）

- [ ] `VITE_WEREWOLF_ADDRESS` を用意（Sepoliaのデプロイ済みコントラクトアドレス）
- [ ] 注意: `VITE_` はクライアントに埋め込まれるため、秘密（MNEMONIC等）を入れない

## C. Sepolia デプロイ（必須）

- [ ] `npm install`
- [ ] `npm run compile`
- [ ] `npx hardhat deploy --network sepolia --tags FHEWerewolf`
- [ ] 出力された `FHEWerewolf` アドレスを控える（＝ `VITE_WEREWOLF_ADDRESS` に入れる値）

## D. Web ローカル確認（必須）

- [ ] `cd apps/web && npm i`
- [ ] `apps/web/.env.local` を作成し、以下を設定
  - [ ] `VITE_WEREWOLF_ADDRESS=<C.で控えたアドレス>`
- [x] `cd apps/web && npm run build` が成功
- [ ] `cd apps/web && npm run dev` で起動し、ブラウザで開ける

## E. Vercel デプロイ（必須）

- [ ] Vercel にプロジェクトを作成（Root Directory は `apps/web`）
- [ ] Vercel Environment Variables（Production）に `VITE_WEREWOLF_ADDRESS` を設定
- [ ] Vercel のURLでページが表示できる
- [ ] Vercel 上で MetaMask 接続できる

## F. Sepolia E2E デモ（必須：提出前に1回通す）

目的: join → role → vote → finalize → reveal まで通す（tie なら round2 も通す）。

### F-1. 事前準備

- [ ] MetaMaskでアカウントを5つ用意（playerId 0..4 用）
- [ ] 各アカウントに Sepolia ETH（ガス代）

### F-2. 5人 Join

- [ ] 5人それぞれ、Vercel（またはローカル）を開く
- [ ] それぞれ `Connect`
- [ ] それぞれ Sepolia になっている（UIの `Switch to Sepolia` が使える）
- [ ] playerId を 0,1,2,3,4 にして `Join`

### F-3. Role（userDecrypt）

- [ ] 5人それぞれ `Get Role` を押して、Typed Data 署名を行う
- [ ] 役職（Werewolf/Villager）が表示される

### F-4. Vote（暗号投票）

- [ ] 5人それぞれ `Vote target`（0..4）を設定して `Submit Vote`

### F-5. Finalize → Reveal

- [ ] 代表1名（誰でもOK）が `Finalize`
- [ ] `Reveal Tie` を実行
  - [ ] tie=false なら次へ
  - [ ] tie=true なら Round2 として F-4〜F-5 をもう一度実行
- [ ] `Reveal Result` を実行
- [ ] `gameEnded=true` / `eliminatedPlayer` / `villagersWin` が更新される

## G. 余計なノイズ除去（必須）

- [x] 提出物として不要なテンプレ/サンプルを削る（例: Counter など、審査の混乱要因）


