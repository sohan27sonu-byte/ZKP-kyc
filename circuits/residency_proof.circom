pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";

template ResidencyProof() {

    // Private inputs — never revealed
    signal input aadhaarPrefix;
    signal input pincode;
    signal input countryCode;
    signal input secret;

    // Public inputs — visible on-chain
    signal input targetCountryCode;
    signal input commitment;

    // Output
    signal output isValid;

    // 1. Verify commitment
    component hasher = Poseidon(4);
    hasher.inputs[0] <== aadhaarPrefix;
    hasher.inputs[1] <== pincode;
    hasher.inputs[2] <== countryCode;
    hasher.inputs[3] <== secret;
    commitment === hasher.out;

    // 2. Aadhaar prefix must be between 2000 and 9999
    component prefixGte = GreaterEqThan(14);
    prefixGte.in[0] <== aadhaarPrefix;
    prefixGte.in[1] <== 2000;

    component prefixLte = LessEqThan(14);
    prefixLte.in[0] <== aadhaarPrefix;
    prefixLte.in[1] <== 9999;

    // 3. Pincode must be between 100000 and 999999
    component pincodeGte = GreaterEqThan(20);
    pincodeGte.in[0] <== pincode;
    pincodeGte.in[1] <== 100000;

    component pincodeLte = LessEqThan(20);
    pincodeLte.in[0] <== pincode;
    pincodeLte.in[1] <== 999999;

    // 4. Country code must equal 91
    component countryCheck = IsEqual();
    countryCheck.in[0] <== countryCode;
    countryCheck.in[1] <== targetCountryCode;

    // 5. Combine checks two at a time (quadratic only)
    signal check1;
    signal check2;
    signal check3;

    check1 <== prefixGte.out * prefixLte.out;
    check2 <== pincodeGte.out * pincodeLte.out;
    check3 <== check1 * check2;

    isValid <== check3 * countryCheck.out;
}

component main {
    public [targetCountryCode, commitment]
} = ResidencyProof();