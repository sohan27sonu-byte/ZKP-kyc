pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";

template AgeProof() {

    // Private inputs
    signal input birthYear;
    signal input birthMonth;
    signal input birthDay;
    signal input secret;

    // Public inputs
    signal input currentYear;
    signal input currentMonth;
    signal input currentDay;
    signal input ageThreshold;
    signal input commitment;

    // Output
    signal output isValid;

    // 1. Verify commitment matches private inputs
    component hasher = Poseidon(4);
    hasher.inputs[0] <== birthYear;
    hasher.inputs[1] <== birthMonth;
    hasher.inputs[2] <== birthDay;
    hasher.inputs[3] <== secret;
    commitment === hasher.out;

    // 2. Compute age
    signal age;
    age <== currentYear - birthYear;

    // 3. Check age >= threshold
    component ageCheck = GreaterEqThan(8);
    ageCheck.in[0] <== age;
    ageCheck.in[1] <== ageThreshold;

    isValid <== ageCheck.out;
}

component main {
    public [currentYear, currentMonth, currentDay, ageThreshold, commitment]
} = AgeProof();