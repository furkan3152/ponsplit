require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-verify");
const path = require("path");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

const SOLC_VERSION = "0.8.24";

// Use the solc-js build shipped in node_modules instead of downloading a compiler.
// This keeps compilation working on machines that cannot reach binaries.soliditylang.org.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion === SOLC_VERSION) {
    const compilerPath = path.join(__dirname, "node_modules", "solc", "soljson.js");
    // solc-js reports "0.8.24+commit.e11b9ed9.Emscripten.clang"; the platform suffix isn't part of
    // the compiler's identity (the bytecode and metadata are the same), and explorers only know
    // "v0.8.24+commit.e11b9ed9", so verification needs it without the suffix.
    const longVersion = require("solc").version().replace(/\.Emscripten\.clang$/, "");
    return { compilerPath, isSolcJs: true, version: args.solcVersion, longVersion };
  }
  return runSuper();
});

const accounts = process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [];

module.exports = {
  solidity: {
    version: SOLC_VERSION,
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: "cancun" },
  },
  networks: {
    // Room for the deep eth_call simulations on a local node.
    hardhat: {
      blockGasLimit: 200_000_000,
      // Lets `hardhat node --fork <robinhood rpc>` execute on forked Robinhood Chain state.
      chains: {
        46630: { hardforkHistory: { cancun: 0 } },
        4663: { hardforkHistory: { cancun: 0 } },
      },
    },
    robinhoodTestnet: {
      url: process.env.ROBINHOOD_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com",
      chainId: 46630,
      accounts,
    },
    robinhood: {
      url: process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
      chainId: 4663,
      accounts,
    },
  },
  // Blockscout explorers accept any API key.
  etherscan: {
    apiKey: { robinhoodTestnet: "blockscout", robinhood: "blockscout" },
    customChains: [
      {
        network: "robinhoodTestnet",
        chainId: 46630,
        urls: { apiURL: "https://explorer.testnet.chain.robinhood.com/api", browserURL: "https://explorer.testnet.chain.robinhood.com" },
      },
      {
        network: "robinhood",
        chainId: 4663,
        urls: { apiURL: "https://robinhoodchain.blockscout.com/api", browserURL: "https://robinhoodchain.blockscout.com" },
      },
    ],
  },
  sourcify: { enabled: false },
};
