import { parseEther } from "viem";

/** Bonding curve for new deployments. Keep in sync with contracts/scripts/deploy.js. */
export const CURVE = {
  virtualEth: parseEther("1.5"),
  virtualToken: parseEther("1073000000"),
  curveSupply: parseEther("793100000"),
  lpSupply: parseEther("206900000"),
} as const;
