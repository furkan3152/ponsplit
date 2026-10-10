import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";

const FEE_PROGRAM = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ";
const FEE_MAGIC = bs58.encode(Uint8Array.from([216, 74, 9, 0, 56, 140, 93, 75]));
const PROOF_MAGIC = bs58.encode(new TextEncoder().encode("TIKPROOF"));
type Scope = { treasury: string | null; program: string | null; verifier: string | null };

/** Narrow read-only scans for this site's fees, proof queue and verified deployment recovery. */
export function accountScanRequest(input: unknown, scope: Scope) {
  const r = input as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown[] } | null;
  if (!r || r.jsonrpc !== "2.0" || r.method !== "getProgramAccounts" || !["string", "number"].includes(typeof r.id)
    || !Array.isArray(r.params) || r.params.length !== 2) return null;
  const [program, raw] = r.params;
  if (typeof program !== "string" || !raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  try { if (new PublicKey(program).toBase58() !== program) return null; } catch { return null; }
  const config = raw as Record<string, unknown>;
  if (Object.keys(config).some(k => !["commitment", "encoding", "filters", "dataSlice"].includes(k))
    || config.commitment !== "confirmed" || config.encoding !== "base64") return null;
  const filters = config.filters;
  const memcmp = (offset: number, bytes: string) => ({ memcmp: { offset, bytes } });
  const expected = program === FEE_PROGRAM && scope.treasury
    ? [memcmp(0, FEE_MAGIC), memcmp(80, scope.treasury)]
    : program === scope.program && scope.verifier
      ? [{ dataSize: 143 }, memcmp(0, PROOF_MAGIC), memcmp(34, scope.verifier)] : null;
  const normalizedFilters = Array.isArray(filters) ? filters.map(filter => {
    if (!filter || typeof filter !== "object" || Array.isArray(filter)) return null;
    if (Object.keys(filter).length !== 1) return null;
    if ("dataSize" in filter) return { dataSize: filter.dataSize };
    const m = filter.memcmp;
    if (!m || typeof m !== "object" || Object.keys(m).some(k => !["offset", "bytes", "encoding"].includes(k))
      || (m.encoding !== undefined && m.encoding !== "base58")) return null;
    return memcmp(m.offset, m.bytes);
  }) : null;
  const fixedScan = expected && JSON.stringify(normalizedFilters) === JSON.stringify(expected) && config.dataSlice === undefined;
  const slice = config.dataSlice as { offset?: unknown; length?: unknown } | undefined;
  const recoveryScan = program !== FEE_PROGRAM && program !== scope.program && filters === undefined
    && slice?.offset === 0 && slice.length === 0 && Object.keys(slice).length === 2;
  if (!fixedScan && !recoveryScan) return null;
  return { request: { jsonrpc: "2.0", id: r.id, method: "getProgramAccounts", params: [program, config] }, program, verifyDeployment: Boolean(recoveryScan) };
}
