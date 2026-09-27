# PonSplit: Robinhood Chain için UseSplit

Bir token çıkar, creator fee'lerini birden fazla X (Twitter) hesabı arasında paylaştır. Hesap sahipleri X ile giriş yapıp paylarını cüzdanlarına çeker. [usesplit.pro](https://usesplit.pro/) fikrinin **Robinhood Chain** (EVM, Arbitrum Orbit L2) versiyonu.

```
contracts/   Solidity kontratları (Hardhat): launchpad, bonding curve, fee kasası
web/         Next.js 14 uygulaması: keşfet, token oluştur, al/sat, fee claim
```

## Nasıl çalışır?

1. **Launch:** Token oluşturan kişi isim, ticker, görsel ve en fazla 10 X hesabı ile yüzde paylarını girer. İsterse aynı işlemde ilk alımı yapar.
2. **Bonding curve:** Token, sanal rezervli sabit çarpım (x·y=k) eğrisinde ETH ile alınıp satılır (pump.fun modeli). Her işlemde **%1 fee** kesilir:
   - %80'i → `FeeVault` içinde X hesaplarına payları oranında yazılır
   - %20'si → protokol
3. **Graduation:** Eğrideki 793.1M token satılınca (varsayılan ayarlarla ~4.25 ETH) eğri kapanır. Herkes `migrate` çağırabilir: toplanan ETH + ayrılmış 206.9M token Uniswap V2 uyumlu bir havuza eklenir ve LP token'ları yakılır.
4. **Claim:** Hesap sahibi `/claim` sayfasında X ile giriş yapar (OAuth 2.0). Sunucu, oturumdaki kullanıcı adı için bir EIP-712 imzası üretir. Kullanıcı bu imzayla `FeeVault.claim` çağırıp birikmiş ETH'yi kendi cüzdanına çeker.

### Güvenlik notları

- **Handle doğrulaması zincir üstünde yapılır.** Kullanıcı adları küçük harf, `a-z0-9_`, 1–15 karakter olmalı. Büyük harf ya da `@` içeren bir handle reddedilir, böylece hiç kimsenin claim edemeyeceği bir hash'e fon gitmez.
- **Eğri aşamasında token transferleri kilitlidir.** Token yalnızca launchpad'e ve launchpad'den hareket eder (al/sat). Bu, birinin migration'dan önce DEX havuzu açıp liste fiyatını manipüle etmesini engeller. Migration ile transferler açılır.
- **Claim imzaları hedef cüzdana bağlıdır.** Nonce ve 15 dakikalık süre ile korunur. İmzayı başkası relay etse bile para yalnızca imzadaki adrese gider.
- **Handle ID değil, kullanıcı adıdır.** Bir X hesabı adını değiştirir ve eski adı başkası alırsa, eski adın birikmiş payını yeni sahibi claim edebilir. X API'den kullanıcı ID'sine çözümleme yapılarak bu risk kapatılabilir; bu MVP'de yok.
- **Eğri sonrası fee yok.** Migration'dan sonra DEX'teki işlemlerden creator fee alınmaz, LP yakıldığı için DEX swap fee'leri havuzda kalır.
- `SIGNER_PRIVATE_KEY` claim'lerin tek yetkilisidir. Sadece sunucuda tutulmalı, deployer anahtarından ayrı olmalı. Sızarsa kontrat sahibi `FeeVault.setSigner` ile değiştirir.
- Kontratlar denetimden (audit) geçmedi. Mainnet'e çıkmadan önce bir audit ve hukuki kontrol önerilir.

## Kontratlar

| Kontrat | Görev |
|---|---|
| `SplitLaunchpad` | Token factory, bonding curve al/sat, fee dağıtımı, graduation, DEX migration |
| `FeeVault` | X handle hash'i başına bakiye; EIP-712 imzalı claim |
| `SplitToken` | Sabit arzlı ERC-20 (1B), migration'a kadar transfer kilidi |

```bash
cd contracts
npm install
npm test                 # 20 test
npm run export-abi       # ABI'leri web/src/lib/abi.ts dosyasına yazar
```

### Deploy (Robinhood Chain testnet)

Testnet ETH: https://faucet.testnet.chain.robinhood.com

```bash
cd contracts
DEPLOYER_PRIVATE_KEY=0x... \
CLAIM_SIGNER_ADDRESS=0x...   \  # web'deki SIGNER_PRIVATE_KEY'in adresi
DEX_FACTORY=0x... WETH=0x... \  # opsiyonel: Uniswap V2 uyumlu factory + WETH
npx hardhat run scripts/deploy.js --network robinhoodTestnet
```

Mainnet için `--network robinhood` kullan. Adresler `contracts/deployments/<network>.json` dosyasına yazılır.

> **DEX:** Migration için zincirdeki Uniswap V2 uyumlu bir factory ve WETH adresi gerekir. Deploy sırasında verilmezse sonradan `launchpad.setDex(factory, weth)` ile ayarlanabilir. Ayarlanmadan graduate olan token'lar ayar yapılana kadar bekler.

Varsayılan parametreler (`setCurveConfig` / `setFees` ile değişir, yeni token'lara uygulanır):

| Parametre | Değer |
|---|---|
| Sanal ETH / sanal token | 1.5 ETH / 1.073B |
| Eğri arzı / LP arzı | 793.1M / 206.9M |
| İşlem fee'si | %1 (en fazla %5) |
| Protokol payı | fee'nin %20'si |
| Oluşturma ücreti / migration ücreti | 0 / %0 |

## Web uygulaması

```bash
cd web
cp .env.example .env.local   # değerleri doldur
npm install
npm run dev
```

Gerekli ortam değişkenleri (`web/.env.example` içinde açıklamalı):

- `NEXT_PUBLIC_CHAIN`: `testnet`, `mainnet` ya da `local`
- `NEXT_PUBLIC_LAUNCHPAD_ADDRESS`, `NEXT_PUBLIC_FEE_VAULT_ADDRESS`: deploy çıktısından
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`: https://cloud.reown.com (tarayıcı cüzdanları bu olmadan da çalışır)
- `NEXTAUTH_URL`, `NEXTAUTH_SECRET`: `openssl rand -base64 32` ile secret üretebilirsin
- `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`: https://developer.x.com üzerinde OAuth 2.0 uygulaması. Callback URL: `{NEXTAUTH_URL}/api/auth/callback/twitter`
- `SIGNER_PRIVATE_KEY`: adresi `FeeVault.signer` ile aynı olmalı

Sayfalar: `/` (keşfet ve ara), `/create` (token çıkar), `/token/[address]` (grafik bilgileri, al/sat, split, migrate), `/claim` (X ile giriş ve claim, herhangi bir handle'ın kazancını sorgulama).

### Yerel deneme (gerçek zincir gerekmez)

```bash
cd contracts && npx hardhat node                                       # terminal 1
cd contracts && npx hardhat run scripts/local-demo.js --network localhost   # terminal 2: mock DEX + 3 örnek token
cd web && npm run dev                                                  # NEXT_PUBLIC_CHAIN=local
```

`local-demo.js` çıktısındaki adresleri `web/.env.local` dosyasına yaz. `SIGNER_PRIVATE_KEY` olarak Hardhat hesabı #1'in anahtarını kullan. MetaMask'e `http://127.0.0.1:8545` (chain 31337) ağını ekleyip Hardhat test hesaplarından birini import edebilirsin.
