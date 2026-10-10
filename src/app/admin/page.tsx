"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import bs58 from "bs58";
import { useCallback, useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { ADMIN_WALLET, MAINNET_GENESIS_HASH } from "@/lib/admin-config";
import { errorMessage, pct, shortAddress } from "@/lib/format";
import { VERIFIER } from "@/lib/tiktok-config";
import { PlatformFees } from "@/components/admin/PlatformFees";
import { ProgramDeployment } from "@/components/admin/ProgramDeployment";
import { ReviewProofs } from "@/components/admin/ReviewProofs";
import {
  createAdminWalletChallenge,
  verifyAdminWalletProof,
  isAdminWalletProofValid,
  type AdminWalletProof,
} from "@/lib/admin-wallet-proof";
import {
  inspectDeployedProgram,
  loadEscrowArtifact,
} from "@/lib/solana/program-deploy";

type AdminSession = {
  readiness: boolean;
  authenticated: boolean;
  wallet: string | null;
};
type AdminStatus = {
  admin: string;
  platformBps: number;
  network: string;
  verificationMode?: "video" | "oauth";
  rpcError?: string;
  configuration: {
    escrowProgram: {
      address: string | null;
      configured: boolean;
      deployed: boolean | null;
      upgradeAuthority: string | null;
      artifactMatches: boolean | null;
    };
    verifier: { address: string | null; configured: boolean };
    oauth: boolean;
    signer: boolean;
    storage: boolean;
    adminAuth: boolean;
  };
  deployment: {
    artifactAvailable: boolean;
    configuredProgram: string | null;
    remainingSetup: string[];
  };
  site: {
    provider: string;
    projectId: string | null;
    automatedConfiguration: boolean;
    published: boolean;
  };
};
type ConfigurationResult = {
  values: {
    NEXT_PUBLIC_TIKSPLIT_ESCROW_PROGRAM_ID: string;
    NEXT_PUBLIC_TIKSPLIT_VERIFIER: string;
  };
  applied: boolean;
  deployment?: { url?: string; id?: string };
  message: string;
};

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(body.error || "The admin request could not be completed.");
  return body;
}

function ReadinessRow({
  label,
  ready,
  detail,
}: {
  label: string;
  ready: boolean | null | undefined;
  detail?: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line py-3 last:border-0">
      <div>
        <div className="text-[13px] font-medium">{label}</div>
        {detail ? (
          <div className="mt-1 break-all font-mono text-[10px] text-ink-3">
            {detail}
          </div>
        ) : null}
      </div>
      <span
        className={`edition-label ${ready === true ? "text-neon" : ready === false ? "text-down-ink" : "text-ink-3"}`}
      >
        {ready === true ? "Ready" : ready === false ? "Needs setup" : "Unknown"}
      </span>
    </div>
  );
}

export default function AdminPage() {
  const { connection } = useConnection();
  const { publicKey, connected, signMessage } = useWallet();
  const { setVisible } = useWalletModal();
  const queryClient = useQueryClient();
  const address = publicKey?.toBase58();
  const matches = Boolean(publicKey?.equals(ADMIN_WALLET));
  const [locked, setLocked] = useState(false);
  const [walletProof, setWalletProof] = useState<AdminWalletProof | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [programId, setProgramId] = useState("");
  const [verifier, setVerifier] = useState(
    VERIFIER?.toBase58() ?? ADMIN_WALLET.toBase58(),
  );
  const [configBusy, setConfigBusy] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configResult, setConfigResult] = useState<ConfigurationResult | null>(
    null,
  );
  const authInFlight = useRef(false);
  const configInFlight = useRef(false);
  const onProgramId = useCallback((value: string) => {
    setProgramId(value);
    setConfigResult(null);
  }, []);
  const session = useQuery({
    queryKey: ["admin-session", address],
    queryFn: () => getJson<AdminSession>("/api/admin/session"),
    refetchInterval: 60_000,
    staleTime: 0,
    retry: false,
  });
  const serverAuthenticated = Boolean(
    matches &&
      connected &&
      !locked &&
      session.data?.authenticated &&
      session.data.wallet === address,
  );
  const authenticated = Boolean(
    matches &&
      connected &&
      !locked &&
      walletProof &&
      now < walletProof.expiresAt &&
      typeof window !== "undefined" &&
      isAdminWalletProofValid(walletProof, publicKey!, window.location.origin),
  );
  const status = useQuery({
    queryKey: ["admin-status", address, serverAuthenticated],
    enabled: authenticated,
    queryFn: () =>
      getJson<AdminStatus>(
        serverAuthenticated ? "/api/admin/status" : "/api/runtime-status",
      ),
    refetchInterval: 30_000,
    retry: false,
  });

  async function authenticate() {
    if (!connected || !publicKey) {
      setVisible(true);
      return;
    }
    if (!matches || authInFlight.current || !signMessage) return;
    authInFlight.current = true;
    setAuthBusy(true);
    setAuthError(null);
    try {
      const challenge = createAdminWalletChallenge(window.location.origin);
      const signature = await signMessage(
        new TextEncoder().encode(challenge.message),
      );
      const proof = await verifyAdminWalletProof(
        challenge,
        publicKey,
        signature,
        window.location.origin,
      );
      setWalletProof(proof);
      setNow(Date.now());
      setLocked(false);
    } catch (error) {
      setAuthError(errorMessage(error));
    } finally {
      setAuthBusy(false);
      authInFlight.current = false;
    }
  }

  async function authenticateHosting() {
    if (!connected || !publicKey) {
      setVisible(true);
      return;
    }
    if (!matches || authInFlight.current || !session.data?.readiness) return;
    if (!signMessage) {
      setAuthError(
        "Choose a wallet that supports signing messages to unlock the admin dashboard.",
      );
      return;
    }
    authInFlight.current = true;
    setAuthBusy(true);
    setAuthError(null);
    try {
      if ((await connection.getGenesisHash()) !== MAINNET_GENESIS_HASH)
        throw new Error(
          "Connect to Solana mainnet before authenticating the admin wallet.",
        );
      const challenge = await getJson<{ message: string }>(
        `/api/admin/challenge?wallet=${encodeURIComponent(publicKey.toBase58())}`,
      );
      const signature = bs58.encode(
        await signMessage(new TextEncoder().encode(challenge.message)),
      );
      const verified = await getJson<AdminSession>("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toBase58(), signature }),
      });
      if (!verified.authenticated || verified.wallet !== publicKey.toBase58())
        throw new Error(
          "The server did not authenticate the connected admin wallet.",
        );
      queryClient.setQueryData(["admin-session", address], verified);
      setLocked(false);
      await session.refetch();
    } catch (error) {
      setAuthError(errorMessage(error));
    } finally {
      setAuthBusy(false);
      authInFlight.current = false;
    }
  }

  async function logout() {
    setLocked(true);
    setWalletProof(null);
    setAuthError(null);
    if (!serverAuthenticated) return;
    try {
      await getJson("/api/admin/logout", { method: "POST" });
      await session.refetch();
    } catch (error) {
      setAuthError(errorMessage(error));
    }
  }

  async function requireCurrentSession() {
    if (!authenticated || !publicKey?.equals(ADMIN_WALLET))
      throw new Error(
        "Authenticate the admin wallet before performing this action.",
      );
    if (
      !walletProof ||
      !isAdminWalletProofValid(walletProof, publicKey!, window.location.origin)
    ) {
      setLocked(true);
      throw new Error(
        "The wallet unlock expired. Sign a fresh message before continuing.",
      );
    }
  }

  async function configure() {
    if (!authenticated || configInFlight.current) return;
    configInFlight.current = true;
    setConfigBusy(true);
    setConfigError(null);
    setConfigResult(null);
    try {
      await requireCurrentSession();
      const program = new PublicKey(programId.trim());
      const verifierKey = new PublicKey(verifier.trim());
      if (
        program.equals(PublicKey.default) ||
        verifierKey.equals(PublicKey.default) ||
        !PublicKey.isOnCurve(verifierKey.toBytes())
      )
        throw new Error(
          "Enter the deployed program ID and an on-curve verification authority public key.",
        );
      let response: ConfigurationResult;
      if (!serverAuthenticated) {
        const artifact = await loadEscrowArtifact();
        if (!(await inspectDeployedProgram(connection, program, artifact)))
          throw new Error(
            "The deployed program does not match this build or the configured admin upgrade authority.",
          );
        response = {
          values: {
            NEXT_PUBLIC_TIKSPLIT_ESCROW_PROGRAM_ID: program.toBase58(),
            NEXT_PUBLIC_TIKSPLIT_VERIFIER: verifierKey.toBase58(),
          },
          applied: false,
          message:
            "Mainnet program and public values validated. Hosting changes require an authenticated server session or your hosting settings.",
        };
      } else
        response = await getJson<ConfigurationResult>(
          "/api/admin/configuration",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              programId: program.toBase58(),
              verifier: verifierKey.toBase58(),
            }),
          },
        );
      setConfigResult(response);
      await status.refetch();
    } catch (error) {
      setConfigError(errorMessage(error));
    } finally {
      setConfigBusy(false);
      configInFlight.current = false;
    }
  }

  return (
    <div className="space-y-6 py-5 sm:py-7">
      <header className="cut-frame border border-line p-5 sm:p-8">
        <div className="flex flex-wrap justify-between gap-4">
          <span className="edition-label text-neon">
            Tiksplit / Operations desk
          </span>
          <span className="edition-label text-ink-3">Solana mainnet</span>
        </div>
        <h1 className="editorial mt-5 text-[50px] leading-[0.88] sm:text-[84px]">
          Platform
          <br />
          control.
        </h1>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
          <p className="max-w-lg text-[14px] leading-relaxed text-ink-2">
            Deploy the escrow, review TikTok video proofs and distribute
            platform creator fees with the admin wallet.
          </p>
          {authenticated ? (
            <button
              className="btn-secondary px-3 py-2 text-[12px]"
              onClick={() => {
                void logout();
              }}
            >
              Lock dashboard
            </button>
          ) : null}
        </div>
      </header>
      {!authenticated ? (
        <section className="editorial-panel max-w-2xl p-5 sm:p-7">
          <div className="edition-label">Restricted access</div>
          <h2 className="editorial mt-3 text-[36px] leading-none">
            Sign with the admin wallet.
          </h2>
          <p className="mt-4 text-[13px] leading-relaxed text-ink-2">
            Connect the configured admin wallet and sign a fresh message for
            this site. Your browser checks the signature and unlocks wallet
            actions for 15 minutes.
          </p>
          <div className="mt-5 border-y border-line py-4">
            <div className="eyebrow">Required wallet</div>
            <div className="mt-2 break-all font-mono text-[12px] text-neon">
              {ADMIN_WALLET.toBase58()}
            </div>
            {address ? (
              <p
                className={`mt-3 font-mono text-[11px] ${matches ? "text-ink-2" : "text-down-ink"}`}
              >
                Connected: {address}
                {!matches ? " · access denied" : ""}
              </p>
            ) : null}
          </div>
          <p className="mt-4 text-[12px] leading-relaxed text-ink-3">
            Deployment, video reviews and fee distributions use your wallet
            directly. Every on-chain action still requires a wallet transaction
            signature.
          </p>
          {authError ? (
            <p role="alert" className="mt-4 text-[13px] text-down-ink">
              {authError}
            </p>
          ) : null}
          <button
            className="btn-primary mt-5 px-5 py-3 text-[14px]"
            disabled={authBusy || (connected && matches && !signMessage)}
            onClick={() => {
              if (!connected || !matches) setVisible(true);
              else void authenticate();
            }}
          >
            {authBusy
              ? "Confirm the message in your wallet…"
              : !connected
                ? "Connect admin wallet →"
                : !matches
                  ? "Switch to the admin wallet →"
                  : "Sign and unlock dashboard →"}
          </button>
        </section>
      ) : (
        <>
          <section className="grid gap-px border border-line bg-line sm:grid-cols-3">
            <div className="bg-card p-5">
              <div className="edition-label text-ink-3">
                Authenticated operator
              </div>
              <div className="mt-3 font-mono text-[16px]">
                {shortAddress(ADMIN_WALLET.toBase58())}
              </div>
            </div>
            <div className="bg-card p-5">
              <div className="edition-label text-ink-3">
                New coin creator fee split
              </div>
              <div className="editorial mt-2 text-[36px] text-neon">
                80% creator / 20% platform
              </div>
            </div>
            <div className="bg-card p-5">
              <div className="edition-label text-ink-3">Authority</div>
              <div className="mt-3 text-[13px] text-ink-2">
                Platform fees and program upgrades. Creator withdrawals stay
                with each verified beneficiary.
              </div>
            </div>
          </section>
          <section className="editorial-panel p-5 sm:p-6">
            <div className="mb-5 border-b border-line pb-4">
              <div className="edition-label text-neon">
                Wallet control unlocked
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-2">
                Native actions are available until{" "}
                {walletProof
                  ? new Date(walletProof.expiresAt).toLocaleTimeString()
                  : "the wallet unlock expires"}
                .{" "}
                {serverAuthenticated
                  ? "Hosting controls also have a server session."
                  : "Hosting changes need a separate server session; you can validate and copy public configuration values now."}
              </p>
              {!serverAuthenticated && session.data?.readiness ? (
                <button
                  className="btn-secondary mt-3 px-3 py-2 text-[12px]"
                  disabled={authBusy}
                  onClick={() => {
                    void authenticateHosting();
                  }}
                >
                  Authenticate hosting controls
                </button>
              ) : null}
              {authError ? (
                <p role="alert" className="mt-3 text-[12px] text-down-ink">
                  {authError}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="edition-label">01 / Production readiness</div>
                <h2 className="editorial mt-2 text-[34px] leading-none">
                  What is connected.
                </h2>
              </div>
              <button
                className="btn-secondary px-3 py-2 text-[12px]"
                disabled={status.isFetching}
                onClick={() => {
                  void status.refetch();
                }}
              >
                Refresh status
              </button>
            </div>
            {status.isLoading ? (
              <p className="mt-5 text-[13px] text-ink-3">
                Reading deployment and production configuration…
              </p>
            ) : status.error ? (
              <p role="alert" className="mt-5 text-[13px] text-down-ink">
                {errorMessage(status.error)}
              </p>
            ) : status.data ? (
              <>
                <div className="mt-5 grid gap-x-8 md:grid-cols-2">
                  <div>
                    <ReadinessRow
                      label="Escrow program deployed"
                      ready={status.data.configuration.escrowProgram.deployed}
                      detail={status.data.configuration.escrowProgram.address}
                    />
                    <ReadinessRow
                      label="Program matches verified build"
                      ready={
                        status.data.configuration.escrowProgram.artifactMatches
                      }
                    />
                    <ReadinessRow
                      label="Admin upgrade authority"
                      ready={
                        status.data.configuration.escrowProgram.upgradeAuthority
                          ? status.data.configuration.escrowProgram
                              .upgradeAuthority === ADMIN_WALLET.toBase58()
                          : null
                      }
                      detail={
                        status.data.configuration.escrowProgram.upgradeAuthority
                      }
                    />
                    <ReadinessRow
                      label="Verification public key"
                      ready={status.data.configuration.verifier.configured}
                      detail={status.data.configuration.verifier.address}
                    />
                  </div>
                  <div>
                    <ReadinessRow
                      label="Video proof verification"
                      ready={
                        status.data.verificationMode === "video"
                          ? status.data.configuration.verifier.address ===
                            ADMIN_WALLET.toBase58()
                          : false
                      }
                      detail="Code in a public TikTok video · admin review · creator activation"
                    />
                    <ReadinessRow
                      label="Image and metadata storage"
                      ready={status.data.configuration.storage}
                    />
                    <ReadinessRow
                      label="Automatic Vercel configuration"
                      ready={status.data.site.automatedConfiguration}
                      detail={status.data.site.projectId}
                    />
                  </div>
                </div>
                {status.data.rpcError ? (
                  <p role="alert" className="mt-4 text-[12px] text-down-ink">
                    {status.data.rpcError}
                  </p>
                ) : null}
                {status.data.deployment.remainingSetup.length ? (
                  <div className="mt-5 border-t border-line pt-4">
                    <div className="edition-label text-ink-3">
                      Remaining setup
                    </div>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] text-ink-2">
                      {status.data.deployment.remainingSetup.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="mt-4 text-[13px] text-neon">
                    All reported production connections are ready.
                  </p>
                )}
                <p className="mt-4 text-[11px] text-ink-3">
                  Reported platform share: {pct(status.data.platformBps)} of
                  pump.fun creator fees · {status.data.network}
                </p>
              </>
            ) : null}
          </section>
          <div className="grid items-start gap-5 xl:grid-cols-2">
            <ProgramDeployment
              enabled={authenticated}
              onProgramId={onProgramId}
              authorize={requireCurrentSession}
            />
            <section className="editorial-panel p-5 sm:p-6">
              <div className="edition-label">03 / Public configuration</div>
              <h2 className="editorial mt-2 text-[34px] leading-none">
                Connect the deployment.
              </h2>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
                Validation checks mainnet ownership, upgrade authority and
                program bytes before accepting these public values. Video proofs
                use the admin wallet as the verification authority.
              </p>
              <form
                className="mt-5 space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void configure();
                }}
              >
                <div>
                  <label className="label" htmlFor="escrow-program-id">
                    Deployed program ID
                  </label>
                  <input
                    id="escrow-program-id"
                    className="input font-mono text-[12px]"
                    value={programId}
                    onChange={(event) => {
                      setProgramId(event.target.value);
                      setConfigResult(null);
                    }}
                    placeholder={
                      status.data?.configuration.escrowProgram.address ??
                      "Solana program public key"
                    }
                    spellCheck={false}
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="verifier-public-key">
                    Verification authority public key
                  </label>
                  <input
                    id="verifier-public-key"
                    className="input font-mono text-[12px]"
                    value={verifier}
                    onChange={(event) => {
                      setVerifier(event.target.value);
                      setConfigResult(null);
                    }}
                    placeholder="Public key of your verification signer"
                    spellCheck={false}
                    autoCapitalize="none"
                    autoCorrect="off"
                  />
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                    Use the public key served by your verifier. Its private key
                    stays with that signer.
                  </p>
                </div>
                {configError ? (
                  <p
                    role="alert"
                    className="bg-down-soft p-3 text-[13px] text-down-ink"
                  >
                    {configError}
                  </p>
                ) : null}
                <button
                  className="btn-primary w-full py-3.5 text-[14px]"
                  disabled={configBusy || !programId.trim() || !verifier.trim()}
                >
                  {configBusy
                    ? "Validating mainnet configuration…"
                    : serverAuthenticated &&
                        status.data?.site.automatedConfiguration
                      ? "Validate and apply to Vercel →"
                      : "Validate public configuration →"}
                </button>
              </form>
              {configResult ? (
                <div className="mt-5 border border-line bg-card-2 p-4">
                  <p
                    role="status"
                    className="text-[13px] leading-relaxed text-neon"
                  >
                    {configResult.message}
                  </p>
                  <dl className="mt-4 space-y-3">
                    {Object.entries(configResult.values).map(([key, value]) => (
                      <div key={key}>
                        <dt className="break-all font-mono text-[10px] text-ink-3">
                          {key}
                        </dt>
                        <dd className="mt-1 break-all font-mono text-[11px] text-ink">
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {configResult.deployment?.url ? (
                    <a
                      className="mt-4 inline-block text-[12px] text-neon hover:underline"
                      href={
                        configResult.deployment.url.startsWith("https://")
                          ? configResult.deployment.url
                          : `https://${configResult.deployment.url}`
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      View site deployment ↗
                    </a>
                  ) : null}
                  {!configResult.applied ? (
                    <p className="mt-4 text-[11px] leading-relaxed text-ink-3">
                      These values have been validated. Apply them to the
                      hosting environment and rebuild the site when you are
                      ready.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>
          </div>
          <ReviewProofs
            enabled={authenticated}
            authorize={requireCurrentSession}
          />
          <PlatformFees
            enabled={authenticated}
            authorize={requireCurrentSession}
            serverAuthenticated={serverAuthenticated}
          />
        </>
      )}
    </div>
  );
}
