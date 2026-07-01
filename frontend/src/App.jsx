import { useState, useCallback, useEffect } from "react";
import { ethers } from "ethers";
import PrivacyKYC_ABI from "./contracts/PrivacyKYC.json";

const CONTRACT_ADDRESS = "0xcEb3C242F87862919bCc8526B7Ec45F3E2E4fBf4";

// ── Shared styles
const card = { background: "#121933", padding: "24px", borderRadius: "12px", border: "1px solid #1f294d", marginBottom: "16px" };
const btn = (disabled) => ({ width: "100%", padding: "14px", background: disabled ? "#1d284d" : "#4f7cff", color: "white", border: "none", borderRadius: "8px", cursor: disabled ? "not-allowed" : "pointer", fontWeight: "bold", marginTop: "10px", opacity: disabled ? 0.6 : 1 });
const btnOutline = { width: "100%", padding: "10px", background: "transparent", color: "#8bb4ff", border: "1px solid #1f294d", borderRadius: "8px", cursor: "pointer", marginTop: "8px" };
const inputStyle = { width: "100%", padding: "12px", borderRadius: "8px", border: "1px solid #1f294d", background: "#0b1020", color: "white", boxSizing: "border-box", marginBottom: "12px" };
const logBox = { background: "#0e152e", padding: "12px", borderRadius: "8px", fontFamily: "monospace", fontSize: "12px", minHeight: "90px", marginBottom: "12px" };
const successCard = { background: "#0d2b1a", border: "1px solid #80ff80", borderRadius: "12px", padding: "24px", textAlign: "center", marginBottom: "16px" };
const badge = (color) => ({ display: "inline-block", padding: "4px 12px", borderRadius: "20px", fontSize: "12px", fontWeight: "bold", background: color === "green" ? "#0d2b1a" : color === "blue" ? "#0d1e3d" : "#2b1a0d", color: color === "green" ? "#80ff80" : color === "blue" ? "#4f7cff" : "#ffaa40", border: `1px solid ${color === "green" ? "#80ff80" : color === "blue" ? "#4f7cff" : "#ffaa40"}`, margin: "4px" });

function StepBar({ current, steps }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2rem" }}>
      {steps.map((label, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
          <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: i <= current ? "#4f7cff" : "#1d284d", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: "bold" }}>
            {i < current ? "✓" : i + 1}
          </div>
          <span style={{ fontSize: "10px", color: i <= current ? "white" : "#8bb4ff", textAlign: "center" }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

// ── AGE PROOF FLOW
function AgeProofFlow({ contract, wallet, onComplete }) {
  const [step, setStep] = useState(0);
  const [birthDate, setBirthDate] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [proofLog, setProofLog] = useState([]);
  const [proofData, setProofData] = useState(null);
  const [commitment, setCommitment] = useState(null);
  const [isTxPending, setIsTxPending] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [txError, setTxError] = useState(null);

  const generateProof = useCallback(async () => {
    if (!birthDate) return;
    setIsGenerating(true);
    setProofLog([]);
    const log = (msg) => setProofLog(p => [...p, msg]);
    try {
      const { groth16 } = await import("snarkjs");
      const { buildPoseidon } = await import("circomlibjs");
      const [year, month, day] = birthDate.split("-").map(Number);
      const now = new Date();
      log("📐 Building Poseidon commitment...");
      const poseidon = await buildPoseidon();
      const secretArr = new Uint8Array(16);
      crypto.getRandomValues(secretArr);
      const secretBig = BigInt("0x" + Array.from(secretArr).map(b => b.toString(16).padStart(2, "0")).join(""));
      const commHash = poseidon([BigInt(year), BigInt(month), BigInt(day), secretBig]);
      const commBig = poseidon.F.toObject(commHash);
      setCommitment(commBig.toString());
      log("⚙️ Running Groth16 prover (10-30 seconds)...");
      const { proof, publicSignals } = await groth16.fullProve(
        { birthYear: year, birthMonth: month, birthDay: day, secret: secretBig, currentYear: now.getFullYear(), currentMonth: now.getMonth() + 1, currentDay: now.getDate(), ageThreshold: 18, commitment: commBig },
        "/age_proof.wasm", "/age_proof_final.zkey"
      );
      log("✅ Age proof generated!");
      const calldata = await groth16.exportSolidityCallData(proof, publicSignals);
      const parsed = JSON.parse("[" + calldata + "]");
      setProofData({ pi_a: parsed[0], pi_b: parsed[1], pi_c: parsed[2], publicSignals: parsed[3] });
      setStep(2);
    } catch (err) {
      log("❌ Error: " + err.message);
    } finally {
      setIsGenerating(false);
    }
  }, [birthDate]);

  const submitOnChain = useCallback(async () => {
    if (!contract || !proofData) return;
    setIsTxPending(true);
    setTxError(null);
    try {
      const tx = await contract.verifyAgeProof(proofData.pi_a, proofData.pi_b, proofData.pi_c, proofData.publicSignals);
      setTxHash(tx.hash);
      await tx.wait();
      setStep(3);
      onComplete();
    } catch (err) {
      setTxError(err.message);
    } finally {
      setIsTxPending(false);
    }
  }, [contract, proofData]);

  if (step === 3) return (
    <div style={successCard}>
      <div style={{ fontSize: "40px" }}>🎉</div>
      <h2 style={{ color: "#80ff80" }}>Age Verified On-Chain!</h2>
      <p>Proved age ≥ 18 without revealing your date of birth.</p>
      {txHash && <a href={`https://sepolia.etherscan.io/tx/${txHash}`} style={{ color: "#4f7cff", fontSize: "13px" }} target="_blank" rel="noreferrer">View on Etherscan ↗</a>}
    </div>
  );

  return (
    <div style={card}>
      <h2>Age Verification</h2>
      <StepBar current={step} steps={["Date of Birth", "Generate Proof", "Submit", "Done"]} />
      {step === 0 && <>
        <p style={{ fontSize: "13px", color: "#8bb4ff" }}>Your date of birth never leaves your browser.</p>
        <input type="date" value={birthDate} max={new Date().toISOString().split("T")[0]} onChange={e => setBirthDate(e.target.value)} style={inputStyle} />
        <button style={btn(!birthDate)} disabled={!birthDate} onClick={() => setStep(1)}>Next →</button>
      </>}
      {step === 1 && <>
        <div style={logBox}>{proofLog.length === 0 ? "Click Generate to start..." : proofLog.map((l, i) => <div key={i}>{l}</div>)}</div>
        <button style={btn(isGenerating)} disabled={isGenerating} onClick={generateProof}>{isGenerating ? "Generating..." : "⚡ Generate Age Proof"}</button>
        <button style={btnOutline} onClick={() => setStep(0)}>← Back</button>
      </>}
      {step === 2 && <>
        <p style={{ fontSize: "13px", color: "#8bb4ff" }}>Only the proof and commitment hash are sent — never your DOB.</p>
        <div style={{ ...logBox, fontSize: "11px", wordBreak: "break-all" }}>Commitment: {commitment?.slice(0, 40)}...</div>
        {txError && <p style={{ color: "#ff6b6b", fontSize: "12px" }}>⚠️ {txError}</p>}
        {txHash && <p style={{ fontSize: "12px" }}>Tx: <a href={`https://sepolia.etherscan.io/tx/${txHash}`} style={{ color: "#4f7cff" }} target="_blank" rel="noreferrer">{txHash.slice(0, 20)}...</a></p>}
        <button style={btn(isTxPending || !wallet)} disabled={isTxPending || !wallet} onClick={submitOnChain}>{isTxPending ? "Mining..." : !wallet ? "Connect wallet first" : "📤 Submit On-Chain"}</button>
      </>}
    </div>
  );
}

// ── RESIDENCY PROOF FLOW
function ResidencyProofFlow({ contract, wallet, onComplete }) {
  const [step, setStep] = useState(0);
  const [aadhaarPrefix, setAadhaarPrefix] = useState("");
  const [pincode, setPincode] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [proofLog, setProofLog] = useState([]);
  const [proofData, setProofData] = useState(null);
  const [commitment, setCommitment] = useState(null);
  const [isTxPending, setIsTxPending] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [txError, setTxError] = useState(null);

  const generateProof = useCallback(async () => {
    if (!aadhaarPrefix || !pincode) return;
    setIsGenerating(true);
    setProofLog([]);
    const log = (msg) => setProofLog(p => [...p, msg]);
    try {
      const { groth16 } = await import("snarkjs");
      const { buildPoseidon } = await import("circomlibjs");
      log("📐 Building Poseidon commitment...");
      const poseidon = await buildPoseidon();
      const secretArr = new Uint8Array(16);
      crypto.getRandomValues(secretArr);
      const secretBig = BigInt("0x" + Array.from(secretArr).map(b => b.toString(16).padStart(2, "0")).join(""));
      const commHash = poseidon([BigInt(aadhaarPrefix), BigInt(pincode), BigInt(91), secretBig]);
      const commBig = poseidon.F.toObject(commHash);
      setCommitment(commBig.toString());
      log("⚙️ Running Groth16 prover (10-30 seconds)...");
      const { proof, publicSignals } = await groth16.fullProve(
        { aadhaarPrefix: Number(aadhaarPrefix), pincode: Number(pincode), countryCode: 91, secret: secretBig, targetCountryCode: 91, commitment: commBig },
        "/residency_proof.wasm", "/residency_proof_final.zkey"
      );
      log("✅ Residency proof generated!");
      const calldata = await groth16.exportSolidityCallData(proof, publicSignals);
      const parsed = JSON.parse("[" + calldata + "]");
      setProofData({ pi_a: parsed[0], pi_b: parsed[1], pi_c: parsed[2], publicSignals: parsed[3] });
      setStep(2);
    } catch (err) {
      log("❌ Error: " + err.message);
    } finally {
      setIsGenerating(false);
    }
  }, [aadhaarPrefix, pincode]);

  const submitOnChain = useCallback(async () => {
    if (!contract || !proofData) return;
    setIsTxPending(true);
    setTxError(null);
    try {
      const tx = await contract.verifyResidencyProof(proofData.pi_a, proofData.pi_b, proofData.pi_c, proofData.publicSignals);
      setTxHash(tx.hash);
      await tx.wait();
      setStep(3);
      onComplete();
    } catch (err) {
      setTxError(err.message);
    } finally {
      setIsTxPending(false);
    }
  }, [contract, proofData]);

  if (step === 3) return (
    <div style={successCard}>
      <div style={{ fontSize: "40px" }}>🎉</div>
      <h2 style={{ color: "#80ff80" }}>Residency Verified On-Chain!</h2>
      <p>Proved Indian residency without revealing your Aadhaar or pincode.</p>
      {txHash && <a href={`https://sepolia.etherscan.io/tx/${txHash}`} style={{ color: "#4f7cff", fontSize: "13px" }} target="_blank" rel="noreferrer">View on Etherscan ↗</a>}
    </div>
  );

  return (
    <div style={card}>
      <h2>India Residency Verification</h2>
      <StepBar current={step} steps={["Your Details", "Generate Proof", "Submit", "Done"]} />
      {step === 0 && <>
        <p style={{ fontSize: "13px", color: "#8bb4ff" }}>Your Aadhaar prefix and pincode never leave your browser.</p>
        <label style={{ fontSize: "12px", color: "#8bb4ff" }}>Aadhaar first 4 digits (e.g. 2345)</label>
        <input type="number" placeholder="e.g. 2345" value={aadhaarPrefix} onChange={e => setAadhaarPrefix(e.target.value)} style={inputStyle} min="2000" max="9999" />
        <label style={{ fontSize: "12px", color: "#8bb4ff" }}>Your pincode</label>
        <input type="number" placeholder="e.g. 400001" value={pincode} onChange={e => setPincode(e.target.value)} style={inputStyle} min="100000" max="999999" />
        <button style={btn(!aadhaarPrefix || !pincode)} disabled={!aadhaarPrefix || !pincode} onClick={() => setStep(1)}>Next →</button>
      </>}
      {step === 1 && <>
        <div style={logBox}>{proofLog.length === 0 ? "Click Generate to start..." : proofLog.map((l, i) => <div key={i}>{l}</div>)}</div>
        <button style={btn(isGenerating)} disabled={isGenerating} onClick={generateProof}>{isGenerating ? "Generating..." : "⚡ Generate Residency Proof"}</button>
        <button style={btnOutline} onClick={() => setStep(0)}>← Back</button>
      </>}
      {step === 2 && <>
        <p style={{ fontSize: "13px", color: "#8bb4ff" }}>Only the proof and commitment hash are sent — never your Aadhaar or pincode.</p>
        <div style={{ ...logBox, fontSize: "11px", wordBreak: "break-all" }}>Commitment: {commitment?.slice(0, 40)}...</div>
        {txError && <p style={{ color: "#ff6b6b", fontSize: "12px" }}>⚠️ {txError}</p>}
        {txHash && <p style={{ fontSize: "12px" }}>Tx: <a href={`https://sepolia.etherscan.io/tx/${txHash}`} style={{ color: "#4f7cff" }} target="_blank" rel="noreferrer">{txHash.slice(0, 20)}...</a></p>}
        <button style={btn(isTxPending || !wallet)} disabled={isTxPending || !wallet} onClick={submitOnChain}>{isTxPending ? "Mining..." : !wallet ? "Connect wallet first" : "📤 Submit On-Chain"}</button>
      </>}
    </div>
  );
}

// ── DASHBOARD
function Dashboard({ contract, wallet }) {
  const [searchAddress, setSearchAddress] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [myStatus, setMyStatus] = useState(null);

  useEffect(() => {
    if (contract && wallet) loadMyStatus();
  }, [contract, wallet]);

  const loadMyStatus = async () => {
    try {
      const details = await contract.getKYCDetails(wallet);
      setMyStatus({
        hasAge: details.hasAge,
        hasResidency: details.hasResidency,
        expiry: Number(details.expiry) > 0 ? new Date(Number(details.expiry) * 1000).toLocaleDateString() : null
      });
    } catch (e) { console.error(e); }
  };

  const checkAddress = async () => {
    if (!searchAddress || !contract) return;
    setLoading(true);
    setResult(null);
    try {
      const details = await contract.getKYCDetails(searchAddress);
      setResult({
        address: searchAddress,
        hasAge: details.hasAge,
        hasResidency: details.hasResidency,
        expiry: Number(details.expiry) > 0 ? new Date(Number(details.expiry) * 1000).toLocaleDateString() : "Not verified"
      });
    } catch (e) {
      setResult({ error: e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {myStatus && (
        <div style={card}>
          <h3 style={{ marginTop: 0, color: "#8bb4ff" }}>My KYC Status</h3>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
            <span style={badge(myStatus.hasAge ? "green" : "orange")}>{myStatus.hasAge ? "✓ Age Verified" : "✗ Age Not Verified"}</span>
            <span style={badge(myStatus.hasResidency ? "green" : "orange")}>{myStatus.hasResidency ? "✓ India Resident" : "✗ Residency Not Verified"}</span>
          </div>
          {myStatus.expiry && <p style={{ fontSize: "12px", color: "#8bb4ff", margin: 0 }}>Expires: {myStatus.expiry}</p>}
        </div>
      )}

      <div style={card}>
        <h3 style={{ marginTop: 0, color: "#8bb4ff" }}>Check Any Address</h3>
        <p style={{ fontSize: "13px", color: "#8bb4ff" }}>Enter any wallet address to check their KYC status on-chain.</p>
        <input
          type="text"
          placeholder="0x..."
          value={searchAddress}
          onChange={e => setSearchAddress(e.target.value)}
          style={inputStyle}
        />
        <button style={btn(!searchAddress || loading)} disabled={!searchAddress || loading} onClick={checkAddress}>
          {loading ? "Checking..." : "🔍 Check KYC Status"}
        </button>

        {result && !result.error && (
          <div style={{ marginTop: "16px", background: "#0b1020", borderRadius: "8px", padding: "14px" }}>
            <p style={{ fontSize: "11px", color: "#8bb4ff", wordBreak: "break-all", margin: "0 0 10px" }}>{result.address}</p>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
              <span style={badge(result.hasAge ? "green" : "orange")}>{result.hasAge ? "✓ Age Verified" : "✗ Age Not Verified"}</span>
              <span style={badge(result.hasResidency ? "green" : "orange")}>{result.hasResidency ? "✓ India Resident" : "✗ Residency Not Verified"}</span>
            </div>
            <p style={{ fontSize: "12px", color: "#8bb4ff", margin: 0 }}>Expiry: {result.expiry}</p>
          </div>
        )}
        {result?.error && <p style={{ color: "#ff6b6b", fontSize: "12px", marginTop: "10px" }}>⚠️ {result.error}</p>}
      </div>
    </div>
  );
}

// ── MAIN APP
export default function ZKPKYCApp() {
  const [wallet, setWallet] = useState(null);
  const [contract, setContract] = useState(null);
  const [activeTab, setActiveTab] = useState("age");
  const [kycDetails, setKycDetails] = useState(null);

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) return alert("Please install MetaMask");
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    const signer = await provider.getSigner();
    const address = await signer.getAddress();
    setWallet(address);
    const kyc = new ethers.Contract(CONTRACT_ADDRESS, PrivacyKYC_ABI.abi, signer);
    setContract(kyc);
    try {
      const details = await kyc.getKYCDetails(address);
      setKycDetails({ hasAge: details.hasAge, hasResidency: details.hasResidency });
    } catch (e) { console.error(e); }
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!contract || !wallet) return;
    try {
      const details = await contract.getKYCDetails(wallet);
      setKycDetails({ hasAge: details.hasAge, hasResidency: details.hasResidency });
    } catch (e) { console.error(e); }
  }, [contract, wallet]);

  const tabs = [
    { id: "age", label: "🎂 Age Proof" },
    { id: "residency", label: "🇮🇳 Residency Proof" },
    { id: "dashboard", label: "📊 Dashboard" }
  ];

  return (
    <div style={{ background: "#0b1020", minHeight: "100vh", color: "white", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: "620px", margin: "auto", padding: "40px 20px" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "24px" }}>🔐 ZKP KYC</h1>
            <p style={{ margin: 0, fontSize: "12px", color: "#8bb4ff" }}>Privacy-Preserving Identity on Ethereum</p>
          </div>
          <button onClick={connectWallet} style={{ background: "#1d284d", color: "white", border: "1px solid #2a3a6d", padding: "10px 16px", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}>
            {wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : "Connect Wallet"}
          </button>
        </div>

        {/* KYC badges */}
        {kycDetails && (
          <div style={{ display: "flex", gap: "8px", marginBottom: "20px", flexWrap: "wrap" }}>
            <span style={badge(kycDetails.hasAge ? "green" : "orange")}>{kycDetails.hasAge ? "✓ Age Verified" : "Age Not Verified"}</span>
            <span style={badge(kycDetails.hasResidency ? "green" : "orange")}>{kycDetails.hasResidency ? "✓ India Resident" : "Residency Not Verified"}</span>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", gap: "4px", marginBottom: "20px" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ flex: 1, padding: "10px 6px", borderRadius: "8px", border: "1px solid #1f294d", background: activeTab === t.id ? "#1d284d" : "transparent", color: activeTab === t.id ? "white" : "#8bb4ff", cursor: "pointer", fontSize: "12px", fontWeight: activeTab === t.id ? "bold" : "normal" }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "age" && <AgeProofFlow contract={contract} wallet={wallet} onComplete={refreshStatus} />}
        {activeTab === "residency" && <ResidencyProofFlow contract={contract} wallet={wallet} onComplete={refreshStatus} />}
        {activeTab === "dashboard" && <Dashboard contract={contract} wallet={wallet} />}

        {/* Footer */}
        <div style={{ marginTop: "24px", padding: "12px", background: "#121933", borderRadius: "8px", fontSize: "11px", color: "#8bb4ff" }}>
          <div>PrivacyKYC: <span style={{ fontFamily: "monospace" }}>{CONTRACT_ADDRESS}</span></div>
          <div style={{ marginTop: "4px" }}>Network: Ethereum Sepolia Testnet</div>
        </div>
      </div>
    </div>
  );
}