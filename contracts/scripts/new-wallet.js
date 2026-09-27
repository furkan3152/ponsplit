// Prints a fresh key pair, e.g. for the web app's claim signer:
//   node scripts/new-wallet.js
// Put the private key in the web app's SIGNER_PRIVATE_KEY (server env only) and pass the
// address as CLAIM_SIGNER_ADDRESS when deploying. Never reuse the deployer key for this.
const { Wallet } = require("ethers");

const w = Wallet.createRandom();
console.log(`address:     ${w.address}`);
console.log(`private key: ${w.privateKey}`);
