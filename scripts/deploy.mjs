import hre from "hardhat";

async function main() {
  console.log("Deploying AgeVerifier...");
  const AgeVerifier = await hre.ethers.getContractFactory("Groth16Verifier");
  const ageVerifier = await AgeVerifier.deploy();
  await ageVerifier.waitForDeployment();
  const ageVerifierAddress = await ageVerifier.getAddress();
  console.log("AgeVerifier deployed to:", ageVerifierAddress);

  console.log("Deploying ResidencyVerifier...");
  const ResidencyVerifier = await hre.ethers.getContractFactory("ResidencyGroth16Verifier");
  const residencyVerifier = await ResidencyVerifier.deploy();
  await residencyVerifier.waitForDeployment();
  const residencyVerifierAddress = await residencyVerifier.getAddress();
  console.log("ResidencyVerifier deployed to:", residencyVerifierAddress);

  console.log("Deploying PrivacyKYC...");
  const PrivacyKYC = await hre.ethers.getContractFactory("PrivacyKYC");
  const privacyKYC = await PrivacyKYC.deploy(ageVerifierAddress, residencyVerifierAddress);
  await privacyKYC.waitForDeployment();
  const kycAddress = await privacyKYC.getAddress();
  console.log("PrivacyKYC deployed to:", kycAddress);

  console.log("\n✅ Deployment complete!");
  console.log("AgeVerifier:       ", ageVerifierAddress);
  console.log("ResidencyVerifier: ", residencyVerifierAddress);
  console.log("PrivacyKYC:        ", kycAddress);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});