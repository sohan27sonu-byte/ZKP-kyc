import { useState, useCallback, useEffect } from "react";
import { ethers } from "ethers";
import PrivacyKYC_ABI from "./contracts/PrivacyKYC.json";

const CONTRACT_ADDRESS = "0xcEb3C242F87862919bCc8526B7Ec45F3E2E4fBf4";
const STORAGE_KEY = "zkp_kyc_birthdate";

// ── Shared styles
const card = { background: "#121933", padding: "24px", borderRadius: "12px", border: "1px solid #1f294d", marginBottom: "16px" };
const btn = (disabled) => ({ width: "100%", padding: "14px", background: disabled ? "#1d284d" : "#4f7cff", color: "white", border: "none", borderRadius: "8px", cursor: disabled ? "not-allowed" : "pointer", fontWeight: "bold", marginTop: "10px", opacity: disabled ? 0.6 : 1 });
const btnOutline = { width: "100%", padding: "10px", background: "transparent", color: "#8bb4ff", border: "1px solid #1f294d", borderRadius: "8px", cursor: "pointer", marginTop: "8px" };
const inputStyle = { width: "100%", padding: "12px", borderRadius: "8px", border: "1px solid #1f294d", background: "#0b1020", color: "white", boxSizing: "border-box", marginBottom: "12px" };
const logBox = { background: "#0e152e", padding: "12px", borderRadius: "8px", fontFamily: "monospace", fontSize: "12px", minHeight: "90px", marginBottom: "12px" };
const successCard = { background: "#0d2b1a", border: "1px solid #80ff80", borderRadius: "12px", padding: "24px", textAlign: "center", marginBottom: "16px" };
const badge = (color) => ({ display: "inline-block", padding: "4px 12px", borderRadius: "20px", fontSize: "12px", fontWeight: "bold", background: color === "green" ? "#0d2b1a" : color === "blue" ? "#0d1e3d" : "#2b1a0d", color: color === "green" ? "#80ff80" : color === "blue" ? "#4f7cff" : "#ffaa40", border: `1px solid ${color === "green" ? "#80ff80" : color === "blue" ? "#4f7cff" : "#ffaa40"}`, margin: "4px" });

// ── Age calculation helper
function getExactAgeDetails(birthDateStr) {
  if (!birthDateStr) return null;
  const parts = birthDateStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  const [y, m, d] = parts;
  if (y < 1900 || y > new Date().getFullYear()) return null;
  const now = new Date();
  let years = now.getFullYear() - y;
  let months = (now.getMonth() + 1) - m;
  let days = now.getDate() - d;
  if (days < 0) {
    months--;
    const prevMonthDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    days += prevMonthDays;
  }
  if (months < 0) {
    years--;
    months += 12;
  }
  if (years < 0 || years > 130) return null;
  return { years, months, days, isAdult: years >= 18 };
}

function getStoredBirthDate() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function saveStoredBirthDate(dob) {
  try {
    if (dob) localStorage.setItem(STORAGE_KEY, dob);
  } catch {}
}

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
function AgeProofFlow({ contract, wallet, kycDetails, onComplete }) {
  const [step, setStep] = useState(0);
  const [birthDate, setBirthDate] = useState(() => getStoredBirthDate());
  const [isGenerating, setIsGenerating] = useState(false);
  const [proofLog, setProofLog] = useState([]);
  const [proofData, setProofData] = useState(null);
  const [commitment, setCommitment] = useState(null);
  const [isTxPending, setIsTxPending] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [txError, setTxError] = useState(null);

  const currentAgeDetails = getExactAgeDetails(birthDate);

  const handleBirthDateChange = (val) => {
    setBirthDate(val);
    saveStoredBirthDate(val);
  };

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
      saveStoredBirthDate(birthDate);
      setStep(3);
      onComplete();
    } catch (err) {
      setTxError(err.message);
    } finally {
      setIsTxPending(false);
    }
  }, [contract, proofData, birthDate, onComplete]);

  // Step 3: SUCCESS SCREEN SHOWING EXACT AGE
  if (step === 3) {
    const ageDetails = currentAgeDetails || getExactAgeDetails(getStoredBirthDate());
    return (
      <div style={successCard}>
        <div style={{ fontSize: "48px", marginBottom: "8px" }}>🎉</div>
        <h2 style={{ color: "#80ff80", fontSize: "24px", margin: "0 0 16px 0" }}>
          Age Verified On-Chain!
        </h2>

        {ageDetails ? (
          <div style={{
            margin: "18px auto",
            padding: "20px",
            background: "linear-gradient(135deg, #072a16 0%, #0d1e3d 100%)",
            borderRadius: "14px",
            border: "2px solid #22c55e",
            boxShadow: "0 0 20px rgba(34, 197, 94, 0.25)",
            maxWidth: "380px"
          }}>
            <div style={{ fontSize: "11px", color: "#86efac", textTransform: "uppercase", letterSpacing: "1.5px", fontWeight: "bold" }}>
              Verified Exact Age
            </div>
            <div style={{ fontSize: "36px", fontWeight: "800", color: "#ffffff", margin: "8px 0 4px" }}>
              {ageDetails.years} years old
            </div>
            <div style={{ fontSize: "13px", color: "#93c5fd", fontWeight: "500" }}>
              ({ageDetails.years} years, {ageDetails.months} months, {ageDetails.days} days)
            </div>
          </div>
        ) : (
          <div style={{ margin: "16px auto", padding: "12px", background: "#062112", borderRadius: "10px", color: "#80ff80" }}>
            Age verified (≥ 18 years)
          </div>
        )}

        <p style={{ margin: "14px 0 10px", color: "#bbf7d0", fontSize: "14px", lineHeight: "1.5" }}>
          Zero-Knowledge Proof verified on Ethereum Sepolia without revealing your date of birth on-chain.
        </p>

        {txHash && (
          <div style={{ marginTop: "12px" }}>
            <a
              href={`https://sepolia.etherscan.io/tx/${txHash}`}
              style={{ color: "#60a5fa", fontSize: "13px", textDecoration: "underline" }}
              target="_blank"
              rel="noreferrer"
            >
              View Transaction on Etherscan ↗
            </a>
          </div>
        )}

        <button
          style={{ ...btnOutline, maxWidth: "220px", margin: "20px auto 0", display: "block" }}
          onClick={() => setStep(0)}
        >
          🔄 Verify Another Date
        </button>
      </div>
    );
  }

  return (
    <div style={card}>
      <h2>Age Verification</h2>
      <StepBar current={step} steps={["Date of Birth", "Generate Proof", "Submit", "Done"]} />

      {step === 0 && <>
        {/* Banner if already verified on-chain */}
        {kycDetails?.hasAge && currentAgeDetails && (
          <div style={{ background: "#062112", border: "1px solid #1f5a35", borderRadius: "10px", padding: "12px 16px", marginBottom: "16px", textAlign: "center" }}>
            <div style={{ fontSize: "11px", color: "#86efac", textTransform: "uppercase", letterSpacing: "1px", fontWeight: "bold" }}>Currently Verified On-Chain</div>
            <div style={{ fontSize: "20px", fontWeight: "bold", color: "#ffffff", margin: "4px 0" }}>
              ✓ Exact Age: {currentAgeDetails.years} years old
            </div>
            <div style={{ fontSize: "12px", color: "#8bb4ff" }}>
              ({currentAgeDetails.years} yrs, {currentAgeDetails.months} mos, {currentAgeDetails.days} days)
            </div>
          </div>
        )}

        <p style={{ fontSize: "13px", color: "#8bb4ff" }}>Your date of birth never leaves your browser.</p>
        <label style={{ fontSize: "12px", color: "#8bb4ff", display: "block", marginBottom: "6px" }}>Select Date of Birth</label>
        <input
          type="date"
          value={birthDate}
          min="1900-01-01"
          max={new Date().toISOString().split("T")[0]}
          onChange={e => handleBirthDateChange(e.target.value)}
          style={inputStyle}
        />

        {/* Live Exact Age Preview */}
        {currentAgeDetails && (
          <div style={{
            padding: "12px 16px",
            borderRadius: "8px",
            marginBottom: "14px",
            background: currentAgeDetails.isAdult ? "#062112" : "#2b1010",
            border: `1px solid ${currentAgeDetails.isAdult ? "#1f5a35" : "#5a1f1f"}`
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: currentAgeDetails.isAdult ? "#80ff80" : "#ff7070", fontWeight: "bold", fontSize: "14px" }}>
                {currentAgeDetails.isAdult ? "✓" : "⚠️"} Calculated Age: {currentAgeDetails.years} years old
              </span>
              <span style={{ fontSize: "11px", color: currentAgeDetails.isAdult ? "#86efac" : "#fca5a5", fontWeight: "bold" }}>
                {currentAgeDetails.isAdult ? "ELIGIBLE (≥ 18)" : "UNDERAGE (< 18)"}
              </span>
            </div>
            <div style={{ fontSize: "12px", color: "#8bb4ff", marginTop: "4px" }}>
              Exact: {currentAgeDetails.years} years, {currentAgeDetails.months} months, {currentAgeDetails.days} days
            </div>
            {!currentAgeDetails.isAdult && (
              <p style={{ color: "#ff8080", fontSize: "12px", margin: "6px 0 0" }}>
                You must be at least 18 years old to verify.
              </p>
            )}
          </div>
        )}

        <button
          style={btn(!birthDate || !currentAgeDetails?.isAdult)}
          disabled={!birthDate || !currentAgeDetails?.isAdult}
          onClick={() => setStep(1)}
        >
          Next →
        </button>
      </>}

      {step === 1 && <>
        <div style={logBox}>
          {proofLog.length === 0 ? "Click Generate to start..." : proofLog.map((l, i) => <div key={i}>{l}</div>)}
        </div>
        <button style={btn(isGenerating)} disabled={isGenerating} onClick={generateProof}>
          {isGenerating ? "Generating Proof..." : "⚡ Generate Age Proof"}
        </button>
        <button style={btnOutline} onClick={() => setStep(0)}>← Back</button>
      </>}

      {step === 2 && <>
        <p style={{ fontSize: "13px", color: "#8bb4ff" }}>Only the zero-knowledge proof and commitment hash are sent — never your date of birth.</p>
        <div style={{ ...logBox, fontSize: "11px", wordBreak: "break-all" }}>
          <div><strong>Exact Age Proving:</strong> {currentAgeDetails?.years} years old</div>
          <div style={{ marginTop: "6px" }}><strong>Commitment:</strong> {commitment?.slice(0, 42)}...</div>
        </div>
        {txError && <p style={{ color: "#ff6b6b", fontSize: "12px" }}>⚠️ {txError}</p>}
        {txHash && (
          <p style={{ fontSize: "12px" }}>
            Tx: <a href={`https://sepolia.etherscan.io/tx/${txHash}`} style={{ color: "#4f7cff" }} target="_blank" rel="noreferrer">{txHash.slice(0, 20)}...</a>
          </p>
        )}
        <button
          style={btn(isTxPending || !wallet)}
          disabled={isTxPending || !wallet}
          onClick={submitOnChain}
        >
          {isTxPending ? "Mining on Sepolia..." : !wallet ? "Connect wallet first" : "📤 Submit On-Chain"}
        </button>
        <button style={btnOutline} onClick={() => setStep(1)}>← Back</button>
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

  const storedAge = getExactAgeDetails(getStoredBirthDate());

  useEffect(() => {
    if (contract && wallet) loadMyStatus();
  }, [contract, wallet]);

  const loadMyStatus = async () => {
    try {
      const details = await contract.getKYCDetails(wallet);
      setMyStatus({
        hasAge: details.hasAge,
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
            <span style={badge(myStatus.hasAge ? "green" : "orange")}>
              {myStatus.hasAge ? "✓ Age Verified (≥ 18)" : "✗ Age Not Verified"}
            </span>
          </div>

          {myStatus.hasAge && storedAge && (
            <div style={{ background: "#062112", border: "1px solid #1f5a35", borderRadius: "8px", padding: "10px 14px", marginBottom: "10px" }}>
              <div style={{ fontSize: "11px", color: "#80ff80", fontWeight: "bold", textTransform: "uppercase" }}>Verified Exact Age</div>
              <div style={{ fontSize: "18px", fontWeight: "bold", color: "#ffffff", marginTop: "2px" }}>
                {storedAge.years} years old
              </div>
              <div style={{ fontSize: "12px", color: "#8bb4ff" }}>
                ({storedAge.years} yrs, {storedAge.months} mos, {storedAge.days} days)
              </div>
            </div>
          )}

          {myStatus.expiry && <p style={{ fontSize: "12px", color: "#8bb4ff", margin: 0 }}>On-Chain Expiry: {myStatus.expiry}</p>}
        </div>
      )}

      <div style={card}>
        <h3 style={{ marginTop: 0, color: "#8bb4ff" }}>Check Any Address</h3>
        <p style={{ fontSize: "13px", color: "#8bb4ff" }}>Enter any Ethereum wallet address to check their Age KYC status on Sepolia.</p>
        <input
          type="text"
          placeholder="0x..."
          value={searchAddress}
          onChange={e => setSearchAddress(e.target.value)}
          style={inputStyle}
        />
        <button style={btn(!searchAddress || loading)} disabled={!searchAddress || loading} onClick={checkAddress}>
          {loading ? "Checking..." : "🔍 Check Age KYC Status"}
        </button>

        {result && !result.error && (
          <div style={{ marginTop: "16px", background: "#0b1020", borderRadius: "8px", padding: "14px" }}>
            <p style={{ fontSize: "11px", color: "#8bb4ff", wordBreak: "break-all", margin: "0 0 10px" }}>{result.address}</p>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
              <span style={badge(result.hasAge ? "green" : "orange")}>{result.hasAge ? "✓ Age Verified" : "✗ Age Not Verified"}</span>
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

  const storedAge = getExactAgeDetails(getStoredBirthDate());

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
      setKycDetails({ hasAge: details.hasAge });
    } catch (e) { console.error(e); }
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!contract || !wallet) return;
    try {
      const details = await contract.getKYCDetails(wallet);
      setKycDetails({ hasAge: details.hasAge });
    } catch (e) { console.error(e); }
  }, [contract, wallet]);

  const tabs = [
    { id: "age", label: "🎂 Age Verification" },
    { id: "dashboard", label: "📊 Dashboard" }
  ];

  return (
    <div style={{ background: "#0b1020", minHeight: "100vh", color: "white", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: "620px", margin: "auto", padding: "40px 20px" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "24px" }}>🔐 ZKP Age KYC</h1>
            <p style={{ margin: 0, fontSize: "12px", color: "#8bb4ff" }}>Privacy-Preserving Age Verification on Ethereum</p>
          </div>
          <button onClick={connectWallet} style={{ background: "#1d284d", color: "white", border: "1px solid #2a3a6d", padding: "10px 16px", borderRadius: "8px", cursor: "pointer", fontSize: "13px" }}>
            {wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : "Connect Wallet"}
          </button>
        </div>

        {/* KYC badges */}
        {kycDetails && (
          <div style={{ display: "flex", gap: "8px", marginBottom: "20px", flexWrap: "wrap" }}>
            <span style={badge(kycDetails.hasAge ? "green" : "orange")}>
              {kycDetails.hasAge ? `✓ Age Verified${storedAge ? ` (${storedAge.years} yrs)` : ""}` : "Age Not Verified"}
            </span>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", gap: "4px", marginBottom: "20px" }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                flex: 1,
                padding: "10px 6px",
                borderRadius: "8px",
                border: "1px solid #1f294d",
                background: activeTab === t.id ? "#1d284d" : "transparent",
                color: activeTab === t.id ? "white" : "#8bb4ff",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: activeTab === t.id ? "bold" : "normal"
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "age" && (
          <AgeProofFlow
            contract={contract}
            wallet={wallet}
            kycDetails={kycDetails}
            onComplete={refreshStatus}
          />
        )}
        {activeTab === "dashboard" && (
          <Dashboard contract={contract} wallet={wallet} />
        )}

        {/* Footer */}
        <div style={{ marginTop: "24px", padding: "12px", background: "#121933", borderRadius: "8px", fontSize: "11px", color: "#8bb4ff" }}>
          <div>PrivacyKYC: <span style={{ fontFamily: "monospace" }}>{CONTRACT_ADDRESS}</span></div>
          <div style={{ marginTop: "4px" }}>Network: Ethereum Sepolia Testnet</div>
        </div>
      </div>
    </div>
  );
}