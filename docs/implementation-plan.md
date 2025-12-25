# FHE Werewolf 実装計画（Smart Contract + Frontend）

本ドキュメントは [docs/about.md](about.md) のMVPを、Zama FHEVM（Solidity）+ Relayer SDK（ブラウザ）で実装するための具体的な計画書です。

---

## 0. 前提（確定）

- プレイヤーは 5 人固定（playerId: 0–4）
- 役職（誰が人狼か）は **Solidity側で生成**し、暗号化状態のまま保持する
- プレイヤーは **自分の役職を知れる**（userDecryptで復号して確認）
- 投票は各プレイヤーが暗号化して送信し、コントラクトが暗号のまま集計する
- 最終結果（処刑playerId / 勝敗）は **チェーン上の平文stateとして確定・保存**する
- バックエンドサーバーは置かない（ブラウザが Relayer SDK で暗号化/復号を行う）

---

## 1. 追加で確認しておくべきこと（未決）

実装を始める前に、以下を「仕様」として確定すると手戻りが減ります。

1) **役職を本人が知れる必要**（確定: Yes）
- プレイヤーは自分の役職を userDecrypt で復号して確認できる

2) **タイブレーク**（同票のときの扱い）
- 仕様（確定）: **同票なら再投票（最大1回）**
  - 投票権: その時点で参加権利があるプレイヤー（= join 済みの 5 人）
  - 再投票でも同じく暗号投票→暗号集計
  - 再投票後も同票になった場合の最終決着: **決定的ルール（小さい playerId 優先）**で確定する

重要: 同票判定について
- 票数は暗号なので、コントラクトが「同票かどうか」を平文の `if` で分岐するには、
  **同票フラグを公開復号して平文化するステップ**が必要になる。
- これにより「同票だった/同票ではなかった」という1bitだけが公開される（個票や役職は公開されない）。

3) **投票先の無効値の扱い**

なぜ発生するか
- 通常UIでは「参加者(0–4)のみ選択」にできるが、ブロックチェーン上では誰でも任意の入力で関数を呼べるため、
  - 悪意のある参加者が“改造したフロント/スクリプト”から範囲外の値を暗号化して送る
  - バグで範囲外が送られる
  といったケースが起き得る。
- ただし本設計では `submitVote(playerId, ...)` を `players[playerId] == msg.sender` で縛るので、
  **第三者が他人の投票を押し付ける**ことはできない（本人の改造は防げない）。

扱い（推奨）
- 暗号のまま `valid = (vote < 5)` を計算し、無効票はカウントに加えない（棄権扱い）。
  - 実装イメージ: `voteCounts[i] += select(valid AND eq(vote,i), 1, 0)` を i=0..4 で展開

4) **ゲーム開始条件**（確定: 5人揃ったら自動開始）
- `join` の中で参加人数が 5 に達したら role 生成→投票フェーズへ遷移

---

## 2. Smart Contract 要件定義（FHEVM）

### 2.1 目的
- 役職・投票・途中集計を暗号のまま扱い、誰にも平文が漏れない
- 最終結果のみを平文stateとして確定する（フロント非依存の検証可能性）

### 2.2 コントラクト構成（新規）
- `contracts/FHEWerewolf.sol` を追加
- `ZamaEthereumConfig` を継承
- `@fhevm/solidity/lib/FHE.sol` を利用

### 2.3 状態（案）

平文（公開）
- `address[5] players`：playerId→address
- `bool[5] joined` / `bool[5] voted` / `bool[5] roleAllowed` など進行管理
- `enum Phase { Join, Vote, Finalizing, Revealed } phase`
- `enum Phase { Join, VoteRound1, WaitingTieReveal, VoteRound2, Finalizing, Revealed } phase`
- `uint8 voteRound`（1 or 2）
- `uint8 eliminatedPlayer`（確定後のみ有効）
- `bool villagersWin`
- `bool gameEnded`

暗号（秘匿）
- `ebool[5] roles`（true = werewolf）
- `euint8[5] voteCounts`
- `euint8 eliminatedIndexEnc`（最終的に公開復号して平文化）
- `ebool villagersWinEnc`（同上）
- `ebool isTieEnc`（Round1の同票判定。公開復号して分岐に使用）

### 2.4 関数（案）

1) `join(uint8 playerId)`
- `Phase.Join` のみ
- `playerId` が空席なら `players[playerId] = msg.sender`

自動開始
- join人数が 5 に達したら内部で `startGame` 相当を実行して `Phase.Vote` へ遷移

2) `startGame()`

備考
- “5人揃ったら自動開始”方針のため、外部公開関数にせず `internal` にしてもよい
- “5人揃ったら自動開始”方針のため、外部公開関数にせず `internal` にしてもよい
- 遷移: `phase = Phase.VoteRound1`, `voteRound = 1`

3) `getMyRoleHandle() external view returns (ebool)`
- role を本人が userDecrypt する場合に必要
- `roles[playerId]` の handle を返す

4) `submitVote(uint8 playerId, externalEuint8 voteExt, bytes calldata proof)`
- `Phase.VoteRound1` または `Phase.VoteRound2` のみ
- 本人確認: `players[playerId] == msg.sender`
- 暗号入力を `FHE.fromExternal(voteExt, proof)` で euint8 化
- **暗号インデックス参照は不可**なので、
  - `voteCounts[i] = voteCounts[i] + select(eq(vote,i), 1, 0)` を i=0..4 で展開して更新

無効票（範囲外）
- UIで防げても、改造クライアントから範囲外値を送れるため、暗号のまま `vote < 5` を検証して無効票は加点しない

5) `finalizeGame()`

Round1 終了（同票判定まで）
- `voteRound == 1` の場合
  - 全員投票済みであること
  - `voteCounts` から argmax を暗号比較で求めて `eliminatedIndexEnc` を一旦セット
  - `isTieEnc`（同票かどうか）を暗号で計算
  - `FHE.makePubliclyDecryptable(isTieEnc)`
  - `phase = Phase.WaitingTieReveal`

Round2（再投票）終了（最終結果）
- `voteRound == 2` の場合
  - 全員投票済みであること
  - `voteCounts` から argmax を暗号比較で求めて `eliminatedIndexEnc` をセット
  - 再投票後の同票は「小さいplayerId優先」で最終確定（暗号比較ロジックを決定的に組む）
  - `villagersWinEnc` を暗号で計算
  - `FHE.makePubliclyDecryptable(eliminatedIndexEnc)`
  - `FHE.makePubliclyDecryptable(villagersWinEnc)`
  - `phase = Phase.Finalizing`

6) `revealTie(bytes abiEncodedCleartexts, bytes decryptionProof, bytes32[] handles)`
- Round1 の `isTieEnc` を公開復号した結果を受け取り、オンチェーン検証して分岐
- `FHE.checkSignatures(handles, abiEncodedCleartexts, decryptionProof)` を通す
- `isTie == false`:
  - Round1の `eliminatedIndexEnc` から `villagersWinEnc` を計算し、
    `FHE.makePubliclyDecryptable(eliminatedIndexEnc)` / `FHE.makePubliclyDecryptable(villagersWinEnc)`
  - `phase = Phase.Finalizing`
- `isTie == true`:
  - `voteRound = 2`, `phase = Phase.VoteRound2`
  - `voted` フラグと `voteCounts` をリセット（0から再集計）

7) `revealResult(bytes abiEncodedCleartexts, bytes decryptionProof, bytes32[] handles)`
- Relayer `publicDecrypt` の結果（平文＋proof）を受け取り、**オンチェーンで正当性を検証**して state を更新
- 検証は `FHE.checkSignatures(handles, abiEncodedCleartexts, decryptionProof)` を使用
- 検証後に `eliminatedPlayer` / `villagersWin` / `gameEnded` をセットし `Phase.Revealed`

備考:
- `FHE.checkSignatures` は「Relayerが返した復号値がKMS署名として正しい」ことを検証する。
  これが無いと、任意の人が嘘の結果で `revealResult` を呼べてしまう。

### 2.5 役職生成（Solidity側）

推奨：FHE乱数（暗号）で狼1名を決める
- `wolfIdxEnc = FHE.randEuint8(8)` など（upperBoundが2の冪制約があるため 8 を使い、0–4 に丸める方針を決める）
- `roles[i] = FHE.eq(wolfIdxEnc, FHE.asEuint8(i))` を i=0..4 で展開

role を本人が知れる必要がある場合
- 各 `roles[i]` に対して
  - `FHE.allowThis(roles[i])`
  - `FHE.allow(roles[i], players[i])`

---

## 3. Frontend 要件定義（Web提出用）

### 3.1 目的
- 参加、投票、結果の閲覧（＋role閲覧が必要なら userDecrypt）までをブラウザで完結
- バックエンド無し

### 3.2 必須機能（MVP）

共通
- Wallet接続（MetaMask想定）
- ネットワーク: Sepolia（Relayer SDKは `SepoliaConfig` を利用）
- コントラクトアドレスの設定（`.env` or 設定ファイル）

画面/フロー（最小）
1) Join
- playerId(0–4)選択 → `join(playerId)`

2) Start（任意）
- 5人揃ったら `startGame()`

3) Role（役職を本人が知る仕様の場合のみ）
- `getMyRoleHandle()` で handle を取得
- `instance.userDecrypt` で復号（EIP-712署名が必要）

4) Vote
- UIで投票先 playerId を選択
- Relayer SDKで encrypted input + proof を作り `submitVote(playerId, voteExt, proof)`

5) Finalize
- `finalizeGame()`

6) Reveal
- `publicDecrypt` で eliminatedIndexEnc/villagersWinEnc の平文+proofを取得
- `revealResult(...)` を送ってオンチェーン確定
- state（`eliminatedPlayer` / `villagersWin`）を表示

### 3.3 実装メモ（Relayer SDK）
- 初期化: `createInstance(SepoliaConfig)`
- 暗号入力: `instance.createEncryptedInput(contractAddress, userAddress)` → `add8(value)` 等 → `encrypt()`
- userDecrypt: handle+contractAddressのペアで復号（bit長上限 2048 に注意）
- publicDecrypt: handle配列を渡して復号（同様に bit長上限）

---

## 4. テンプレ置換の作業計画（リポジトリ手順）

### 4.1 Solidity
- 追加: `contracts/FHEWerewolf.sol`
- 追加: `deploy/werewolf.ts`
- 追加: `tasks/Werewolf.ts`
- 追加: `test/Werewolf.ts`（ローカルmock向け）
- 任意: `test/WerewolfSepolia.ts`（E2E）

### 4.2 Frontend
- 新規ディレクトリを追加（例）
  - `apps/web/`（Vite または Next.js を採用）
- `@zama-fhe/relayer-sdk` をフロントで利用

---

## 5. マイルストーン（推奨順）

M1: スマコン骨格
- join/start/投票受け取りまで

M2: 暗号集計
- voteCounts 更新、finalize で暗号結果（eliminatedIndexEnc/villagersWinEnc）まで

M3: オンチェーン結果確定
- makePubliclyDecryptable + publicDecrypt + revealResult + checkSignatures

M4: Web UI
- Join/Vote/Finalize/Reveal
- （必要なら）Role表示（userDecrypt）

---

## 6. 受け入れ条件（Definition of Done）

- 役職・個票・途中集計が平文で読めない
- 5人で投票→ finalize → reveal を通すと、
  - `eliminatedPlayer` と `villagersWin` がチェーンstateとして確定する
- Web UI だけで上記フローが再現できる
