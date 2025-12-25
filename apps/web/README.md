# FHE Werewolf Web (Vite + React)

Sepolia 上の `FHEWerewolf` コントラクトに接続してデモ操作（Join/Role/Vote/Finalize/Reveal）を行うフロントです。

## 必要な環境変数

Vite の `VITE_` 変数はクライアントに埋め込まれます（秘密情報は入れない）。

- `VITE_WEREWOLF_ADDRESS` : Sepolia にデプロイした `FHEWerewolf` のアドレス

例:

- `apps/web/.env.local`

```bash
VITE_WEREWOLF_ADDRESS=0x...
```

ひな形は `apps/web/.env.example`。

## 起動

```bash
cd apps/web
npm i
npm run dev
```

## ビルド

```bash
cd apps/web
npm run build
```

## Vercel

- Project Settings → Environment Variables に `VITE_WEREWOLF_ADDRESS` を追加
- その後、通常どおり Deploy

## 注意

- Sepolia ネットワークで MetaMask 接続が必要
- `Get Role` は Typed Data 署名を求めます
