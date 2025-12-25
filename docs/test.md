# Hardhat テストチェックリスト（FHE Werewolf）

このドキュメントは、FHE Werewolf のスマートコントラクトを Hardhat でテストする際のチェックリストです。

対象:
- ローカル（FHEVM mock）で動くユニット/統合テスト
- FHE特有の入力（externalE* + proof）、ACL、公開復号proof検証フロー

前提:
- 仕様は [docs/implementation-plan.md](implementation-plan.md) に準拠

---

## 1. デプロイ/初期状態

- [x] デプロイが成功する
- [x] 初期 `phase` が Join である
- [ ] `players[0..4]` が空である
- [ ] `joined/voted` が全て false である
- [x] `voteRound` が 0（未開始）である
- [x] `gameEnded == false` である

---

## 2. Join（参加）

- [x] `join(playerId)` で該当スロットに `msg.sender` が登録される
- [x] 同じ `playerId` に二重参加できない（revert）
- [x] `playerId` が範囲外（>=5）ならrevert
- [x] 同一アドレスが複数playerIdに参加できない（revert）

### 自動開始（5人揃ったら開始）

- [x] 5人目の join で自動的に投票フェーズへ遷移する
- [x] 自動開始後に join はできない（revert）

---

## 3. 役職生成（Solidity側）

> 役職は暗号状態のまま保持され、本人のみ userDecrypt で確認できる（ACL付与）

- [x] 5人揃ったタイミングで役職が生成される
- [x] 生成後、各プレイヤーが「自分の役職handle」を取得できる（view関数がある場合）
- [x] 役職handleに対して `FHE.allowThis` が付与されている（コントラクト運用上必要）
- [x] 役職handleに対して `FHE.allow(role, playerAddress)` が付与されている（本人が userDecrypt 可能）

※ローカルテストで userDecrypt まで通すかは環境次第（可能ならE2Eに含める）

---

## 4. Vote（投票）入力バリデーション

- [x] `submitVote(playerId, ...)` は `players[playerId] == msg.sender` で縛られている（第三者が投票を押し付けられない）
- [ ] 未参加の playerId で `submitVote` できない（revert）
- [x] 同一ラウンドで二重投票できない（revert）
- [x] フェーズ外で投票できない（revert）

### 無効投票値（0–4以外）

- [x] 参加者が改造クライアントで範囲外を送っても、暗号のまま `vote < 5` 判定により「棄権扱い」になり票が加算されない
- [x] 票が加算されないことを間接的に確認できる（無効票を混ぜても結果が変わらない等）

---

## 5. Round1 集計（同票判定まで）

- [x] 5人全員投票済みでないと Round1 集計に進めない（revert）
- [x] Round1 集計後、同票判定用の暗号フラグが公開復号可能化される（`makePubliclyDecryptable(isTieEnc)`）
- [x] Round1 集計後、`phase` が `WaitingTieReveal` に遷移する

---

## 6. 同票処理（再投票 最大1回）

### revealTie（公開復号proof検証）

- [x] `revealTie(...)` は proof をオンチェーン検証し、検証失敗ならrevertする
- [x] `revealTie(...)` に不正な平文（改ざん）を渡すとrevertする

### isTie == true の場合

- [x] `voteRound` が 2 になり `phase` が `VoteRound2` に遷移する
- [x] `voted` がリセットされ、再投票できる
- [ ] `voteCounts` がリセットされ、Round2はゼロから再集計される

### isTie == false の場合

- [x] `phase` が `Finalizing` に進み、最終結果の公開復号フェーズへ入る

---

## 7. Round2 集計（最終確定）

- [ ] Round2でも全員投票済みでないと集計できない（revert）
- [x] Round2の集計で `eliminatedIndexEnc` / `villagersWinEnc` が生成される
- [x] Round2後、結果ciphertextが公開復号可能化される（`makePubliclyDecryptable`）

### Round2も同票だった場合

- [ ] 「小さいplayerId優先」で決定的に確定する（誰が呼んでも同じ結果になる）

---

## 8. revealResult（結果のオンチェーン確定）

- [x] `revealResult(...)` は proof をオンチェーン検証し、検証失敗ならrevertする
- [x] 検証成功時、`eliminatedPlayer` が期待通りにセットされる
- [x] 検証成功時、`villagersWin` が期待通りにセットされる
- [x] 検証成功時、`gameEnded == true` になる
- [x] `phase == Revealed` になる
- [x] 二重に `revealResult` を呼べない（revert or no-op。仕様で決める）

---

## 9. セキュリティ/不正ケース

- [ ] 参加者以外が `finalize` / `revealTie` / `revealResult` を呼べるか（仕様通りに制御）
- [ ] 他人の playerId を指定して投票できない（`msg.sender` 照合）
- [ ] proof/handle の順序違いで検証が通らない（revert）
- [ ] 想定外の状態遷移ができない（phaseガード）

---

## 10. イベント/UX（任意だが推奨）

- [ ] Join/Vote/Phase遷移/Reveal のイベントが出る（フロントから追いやすい）
- [ ] フロントに必要な view が揃っている（players、phase、結果、必要なら自分のrole handle）

---

## 11. ローカル vs Sepolia

- [ ] ローカル（mock）で基本フローが通る
- [ ] SepoliaでE2E（暗号入力→投票→公開復号→オンチェーン確定）が通る（別テスト/スクリプトでも可）
