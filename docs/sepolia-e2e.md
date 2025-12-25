# Sepolia E2E 手順（提出/審査用）

この手順は「Sepolia（実暗号）で、FHE Werewolf を最短でデモする」ための固定手順です。

## 0. 前提

- Sepolia のウォレットが用意できている（MetaMask）
- 5人プレイ想定（アカウントを5つ用意）
- 各アカウントに Sepolia ETH（ガス代）が必要

## 1. コントラクトを Sepolia にデプロイ

このリポジトリは Hardhat の `vars` を使います（`.env` ではなく `npx hardhat vars set ...` が基本）。

1) 変数を設定

- `npx hardhat vars set MNEMONIC`
- `npx hardhat vars set INFURA_API_KEY`
- （任意）`npx hardhat vars set ETHERSCAN_API_KEY`

2) コンパイル

- `npm run compile`

3) デプロイ

- `npx hardhat deploy --network sepolia --tags FHEWerewolf`

出力されたコントラクトアドレスを控えます。

（任意）verify

- `npx hardhat verify --network sepolia <CONTRACT_ADDRESS>`

## 2. フロントを Sepolia 用に起動

### ローカル

- `cd apps/web`
- `npm i`
- `echo "VITE_WEREWOLF_ADDRESS=<CONTRACT_ADDRESS>" > .env.local`
- `npm run dev`

### Vercel

- Vercel の Project Settings → Environment Variables に `VITE_WEREWOLF_ADDRESS=<CONTRACT_ADDRESS>` を追加
- Build は通常どおり（Vite）。`VITE_` はクライアントに埋め込まれる前提なので秘密は入れない

## 3. デモ導線（Join → Role → Vote → Finalize → Reveal）

### 3.1 5アカウントの用意

- ブラウザの「プロファイル」を分ける / 別ブラウザを使う / MetaMaskのアカウントを切り替える
- 同一タブでアカウントを切り替えると署名対象が混乱しやすいので、できれば分ける

### 3.2 接続と Join

各アカウントで以下を行います。

1) Sepolia を選択（UIの `Switch to Sepolia` でも可）
2) `Connect`
3) `playerId` をそれぞれ 0,1,2,3,4 にして `Join`

5人揃うとゲームが開始します。

### 3.3 役職確認（userDecrypt）

各アカウントで `Get Role` を実行します。

- 署名（Typed Data）が求められます
- 成功すると `Werewolf / Villager` が表示されます

### 3.4 投票（暗号投票）

各アカウントで `Vote target` を設定して `Submit Vote`。

- 0〜4 の範囲で投票
- 5人全員の投票が揃う必要があります

### 3.5 Round1 Finalize

誰が押してもOKです（運営者固定で1人が押すのが分かりやすい）。

- `Finalize` を実行

### 3.6 Tie 判定の Reveal（publicDecrypt → revealTie）

- `Reveal Tie` を実行

ここで
- Tie でなければ次の「最終結果 Reveal」へ
- Tie なら Round2 が開始され、再度 3.4〜3.6 を繰り返します

### 3.7 最終結果の Reveal（publicDecrypt → revealResult）

- `Reveal Result` を実行

成功すると
- `eliminatedPlayer` と `villagersWin` が更新され、ゲームが終了します。

## 4. よくある詰まりどころ

- Sepolia 以外のネットワークで叩いている（UIに Not Sepolia と出る）
- `VITE_WEREWOLF_ADDRESS` が違う/空
- 5人揃っていない（Join不足）
- 5人全員が投票していない（Finalizeできない）
- publicDecrypt の完了待ち（ネットワーク状況によって遅い）
