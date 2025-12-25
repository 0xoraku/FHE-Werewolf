import {
  createInstance,
  SepoliaConfig,
  type FhevmInstance,
  type PublicDecryptResults,
} from '@zama-fhe/relayer-sdk/web'
import { BrowserProvider, Contract, Interface, ZeroAddress, hexlify } from 'ethers'
import { useCallback, useMemo, useState } from 'react'
import './App.css'
import { FHEWerewolfAbi, PhaseLabel } from './werewolfAbi'

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider
  }
}

type Status = {
  phase?: number
  voteRound?: number
  gameEnded?: boolean
  eliminatedPlayer?: number
  villagersWin?: boolean
  myPlayerId?: number
}

function App() {
  const [contractAddress, setContractAddress] = useState<string>(import.meta.env.VITE_WEREWOLF_ADDRESS ?? '')
  const [walletAddress, setWalletAddress] = useState<string>('')
  const [chainId, setChainId] = useState<number | null>(null)
  const [provider, setProvider] = useState<BrowserProvider | null>(null)
  const [instance, setInstance] = useState<FhevmInstance | null>(null)

  const [status, setStatus] = useState<Status>({})
  const [playerIdInput, setPlayerIdInput] = useState<number>(0)
  const [voteTargetInput, setVoteTargetInput] = useState<number>(0)

  const [lastIsTieHandle, setLastIsTieHandle] = useState<string>('')
  const [lastEliminatedIndexHandle, setLastEliminatedIndexHandle] = useState<string>('')
  const [lastVillagersWinHandle, setLastVillagersWinHandle] = useState<string>('')

  const [roleText, setRoleText] = useState<string>('')
  const [busy, setBusy] = useState<string>('')
  const [error, setError] = useState<string>('')

  const iface = useMemo(() => new Interface(FHEWerewolfAbi as unknown as any[]), [])

  const contract = useMemo(() => {
    if (!provider) return null
    if (!contractAddress || contractAddress === ZeroAddress) return null
    return new Contract(contractAddress, FHEWerewolfAbi, provider)
  }, [provider, contractAddress])

  const contractWithSigner = useMemo(() => {
    if (!provider) return null
    if (!contractAddress || contractAddress === ZeroAddress) return null
    return (async () => {
      const signer = await provider.getSigner()
      return new Contract(contractAddress, FHEWerewolfAbi, signer)
    })()
  }, [provider, contractAddress])

  const readStatus = useCallback(async (c: Contract) => {
    const [phase, voteRound, gameEnded, eliminatedPlayer, villagersWin] = await Promise.all([
      c.phase(),
      c.voteRound(),
      c.gameEnded(),
      c.eliminatedPlayer(),
      c.villagersWin(),
    ])

    let myPlayerId: number | undefined
    try {
      const v = await c.getMyPlayerId()
      myPlayerId = Number(v)
    } catch {
      myPlayerId = undefined
    }

    setStatus({
      phase: Number(phase),
      voteRound: Number(voteRound),
      gameEnded: Boolean(gameEnded),
      eliminatedPlayer: Number(eliminatedPlayer),
      villagersWin: Boolean(villagersWin),
      myPlayerId,
    })
  }, [])

  const refreshStatus = useCallback(async () => {
    setError('')
    if (contract) {
      await readStatus(contract)
      return
    }
    if (!provider || !contractAddress) return
    const c = new Contract(contractAddress, FHEWerewolfAbi, provider)
    await readStatus(c)
  }, [contract, contractAddress, provider, readStatus])

  const connect = useCallback(async () => {
    setError('')
    if (!window.ethereum) {
      setError('window.ethereum が見つかりません（MetaMask等が必要です）')
      return
    }
    if (!contractAddress) {
      setError('コントラクトアドレスを入力してください')
      return
    }

    setBusy('connect')
    try {
      await window.ethereum.request({ method: 'eth_requestAccounts' })
      const p = new BrowserProvider(window.ethereum as any)
      const net = await p.getNetwork()
      const signer = await p.getSigner()
      const addr = await signer.getAddress()
      setProvider(p)
      setWalletAddress(addr)
      setChainId(Number(net.chainId))

      const fhevm = await createInstance(SepoliaConfig)
      setInstance(fhevm)

      const c = new Contract(contractAddress, FHEWerewolfAbi, p)
      await readStatus(c)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }, [contractAddress, readStatus])

  const requireReady = useCallback(() => {
    if (!provider) throw new Error('未接続です（Connectを押してください）')
    if (!contractAddress) throw new Error('コントラクトアドレスが空です')
    if (!instance) throw new Error('Relayer SDK が未初期化です')
  }, [provider, contractAddress, instance])

  const join = useCallback(async () => {
    setError('')
    requireReady()
    setBusy('join')
    try {
      const c = await contractWithSigner
      if (!c) throw new Error('コントラクトが初期化されていません')
      const tx = await c.join(playerIdInput)
      await tx.wait()
      await refreshStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }, [contractWithSigner, playerIdInput, refreshStatus, requireReady])

  const fetchRole = useCallback(async () => {
    setError('')
    requireReady()
    setBusy('role')
    try {
      const c = await contractWithSigner
      if (!c) throw new Error('コントラクトが初期化されていません')

      const roleHandle: string = await c.getMyRoleHandle()
      const keypair = instance!.generateKeypair()
      const handleContractPairs = [{ handle: roleHandle, contractAddress }]
      const startTimestamp = Math.floor(Date.now() / 1000).toString()
      const durationDays = '10'
      const contractAddresses = [contractAddress]

      const eip712 = instance!.createEIP712(keypair.publicKey, contractAddresses, startTimestamp, durationDays)
      const signature = await (await provider!.getSigner()).signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
        eip712.message,
      )

      const results = await instance!.userDecrypt(
        handleContractPairs,
        keypair.privateKey,
        keypair.publicKey,
        signature.replace('0x', ''),
        contractAddresses,
        walletAddress,
        startTimestamp,
        durationDays,
      )

      const decrypted = results[roleHandle as `0x${string}`]
      if (typeof decrypted !== 'boolean') throw new Error('role の復号結果が想定外です')
      setRoleText(decrypted ? 'Werewolf' : 'Villager')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }, [contractAddress, instance, provider, requireReady, walletAddress])

  const submitVote = useCallback(async () => {
    setError('')
    requireReady()
    setBusy('vote')
    try {
      const c = await contractWithSigner
      if (!c) throw new Error('コントラクトが初期化されていません')
      if (status.myPlayerId === undefined) throw new Error('join 済みのウォレットで実行してください')

      const encryptedInput = instance!.createEncryptedInput(contractAddress, walletAddress)
      const { handles, inputProof } = await encryptedInput.add8(BigInt(voteTargetInput)).encrypt()
      if (!handles[0]) throw new Error('encrypt の戻り値が不正です（handleがありません）')

      const voteExt = hexlify(handles[0])
      const proofHex = hexlify(inputProof)

      const tx = await c.submitVote(status.myPlayerId, voteExt, proofHex)
      await tx.wait()
      await refreshStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }, [contractAddress, contractWithSigner, instance, refreshStatus, requireReady, status.myPlayerId, voteTargetInput, walletAddress])

  const parseReceiptForHandles = useCallback(
    (receipt: any) => {
      if (!receipt?.logs) return
      for (const log of receipt.logs) {
        if (!log?.address) continue
        if (String(log.address).toLowerCase() !== contractAddress.toLowerCase()) continue

        try {
          const parsed = iface.parseLog({ topics: log.topics, data: log.data })
          if (parsed?.name === 'Round1Finalized') {
            setLastIsTieHandle(parsed.args[0] as string)
          }
          if (parsed?.name === 'Finalizing') {
            setLastEliminatedIndexHandle(parsed.args[0] as string)
            setLastVillagersWinHandle(parsed.args[1] as string)
          }
        } catch {
          // ignore
        }
      }
    },
    [contractAddress, iface],
  )

  const finalize = useCallback(async () => {
    setError('')
    requireReady()
    setBusy('finalize')
    try {
      const c = await contractWithSigner
      if (!c) throw new Error('コントラクトが初期化されていません')
      const tx = await c.finalizeGame()
      const receipt = await tx.wait()
      parseReceiptForHandles(receipt)
      await refreshStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }, [contractWithSigner, parseReceiptForHandles, refreshStatus, requireReady])

  const revealTie = useCallback(async () => {
    setError('')
    requireReady()
    if (!lastIsTieHandle) {
      setError('isTieHandle がありません（まず finalizeGame してください）')
      return
    }
    setBusy('revealTie')
    try {
      const c = await contractWithSigner
      if (!c) throw new Error('コントラクトが初期化されていません')

      const results: PublicDecryptResults = await instance!.publicDecrypt([lastIsTieHandle])
      const tx = await c.revealTie(results.abiEncodedClearValues, results.decryptionProof, [lastIsTieHandle])
      const receipt = await tx.wait()
      parseReceiptForHandles(receipt)
      await refreshStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }, [contractWithSigner, instance, lastIsTieHandle, parseReceiptForHandles, refreshStatus, requireReady])

  const revealResult = useCallback(async () => {
    setError('')
    requireReady()
    if (!lastEliminatedIndexHandle || !lastVillagersWinHandle) {
      setError('結果handlesがありません（Finalizingイベントのハンドルが必要です）')
      return
    }
    setBusy('revealResult')
    try {
      const c = await contractWithSigner
      if (!c) throw new Error('コントラクトが初期化されていません')

      const results: PublicDecryptResults = await instance!.publicDecrypt([
        lastEliminatedIndexHandle,
        lastVillagersWinHandle,
      ])
      const tx = await c.revealResult(results.abiEncodedClearValues, results.decryptionProof, [
        lastEliminatedIndexHandle,
        lastVillagersWinHandle,
      ])
      await tx.wait()
      await refreshStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }, [contractWithSigner, instance, lastEliminatedIndexHandle, lastVillagersWinHandle, refreshStatus, requireReady])

  const sepoliaOk = chainId === null ? null : chainId === 11155111

  return (
    <div className="container">
      <h1>FHE Werewolf (MVP)</h1>

      <section>
        <h2>Config</h2>
        <div className="row">
          <label>
            Contract Address
            <input
              value={contractAddress}
              onChange={(e) => setContractAddress(e.target.value.trim())}
              placeholder="0x..."
              spellCheck={false}
            />
          </label>
          <button onClick={connect} disabled={busy !== ''}>
            Connect
          </button>
          <button onClick={refreshStatus} disabled={!contract || busy !== ''}>
            Refresh
          </button>
        </div>
        <div className="mono">
          wallet: {walletAddress || '(not connected)'}
          <br />
          chainId: {chainId ?? '(unknown)'} {sepoliaOk === false ? '(Sepolia以外)' : ''}
        </div>
      </section>

      <section>
        <h2>State</h2>
        <div className="mono">
          phase: {status.phase ?? '(?)'} {status.phase !== undefined ? `(${PhaseLabel[status.phase] ?? 'Unknown'})` : ''}
          <br />
          voteRound: {status.voteRound ?? '(?)'}
          <br />
          myPlayerId: {status.myPlayerId ?? '(not joined)'}
          <br />
          gameEnded: {String(status.gameEnded ?? false)}
          <br />
          eliminatedPlayer: {status.eliminatedPlayer ?? '(?)'}
          <br />
          villagersWin: {status.villagersWin === undefined ? '(?)' : String(status.villagersWin)}
        </div>
      </section>

      <section>
        <h2>Join</h2>
        <div className="row">
          <label>
            playerId (0-4)
            <input
              type="number"
              min={0}
              max={4}
              value={playerIdInput}
              onChange={(e) => setPlayerIdInput(Number(e.target.value))}
            />
          </label>
          <button onClick={join} disabled={busy !== ''}>
            Join
          </button>
        </div>
      </section>

      <section>
        <h2>Role (userDecrypt)</h2>
        <div className="row">
          <button onClick={fetchRole} disabled={busy !== ''}>
            Get My Role
          </button>
          <div className="mono">{roleText ? `role: ${roleText}` : 'role: (not fetched)'}</div>
        </div>
      </section>

      <section>
        <h2>Vote (encrypted)</h2>
        <div className="row">
          <label>
            vote target (0-4)
            <input
              type="number"
              min={0}
              max={4}
              value={voteTargetInput}
              onChange={(e) => setVoteTargetInput(Number(e.target.value))}
            />
          </label>
          <button onClick={submitVote} disabled={busy !== ''}>
            Submit Vote
          </button>
        </div>
      </section>

      <section>
        <h2>Finalize / Reveal</h2>
        <div className="row">
          <button onClick={finalize} disabled={busy !== ''}>
            Finalize
          </button>
          <button onClick={revealTie} disabled={busy !== ''}>
            Reveal Tie
          </button>
          <button onClick={revealResult} disabled={busy !== ''}>
            Reveal Result
          </button>
        </div>

        <div className="mono">
          isTieHandle: {lastIsTieHandle || '(none)'}
          <br />
          eliminatedIndexHandle: {lastEliminatedIndexHandle || '(none)'}
          <br />
          villagersWinHandle: {lastVillagersWinHandle || '(none)'}
        </div>
      </section>

      {busy ? <p className="mono">busy: {busy}</p> : null}
      {error ? <p className="error">error: {error}</p> : null}
      {!window.ethereum ? <p className="error">MetaMask等のウォレット拡張が必要です。</p> : null}
    </div>
  )
}

export default App
