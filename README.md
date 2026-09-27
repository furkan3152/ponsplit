<p align="center"><img src="web/public/hero.svg" width="480" alt="PonSplit"></p>

# PonSplit

**Tek coin, birden fazla X hesabı, fee'ler otomatik bölünür.** Robinhood Chain üzerinde bir coin çıkar. Her al/sat işleminden kesilen fee, seçtiğin X (Twitter) hesapları arasında paylaştırılır. Bu hem bonding curve aşamasında hem de coin "mezun olduktan" sonra geçerli. Hesap sahipleri X ile giriş yapıp paylarını istedikleri cüzdana çeker.

```
contracts/   Solidity (Hardhat): SplitLaunchpad, FeeVault, SplitToken
web/         Next.js 14 uygulaması: keşfet, coin çıkar, grafik + al/sat, claim, portföy
.github/     CI + tek tıkla kontrat deploy workflow'u
```

## Nasıl çalışır?

1. **Launch:** Coin'i oluşturan kişi isim, ticker, görsel, açıklama/linkler ve en fazla 10 X hesabıyla bu hesapların paylarını girer.
   - Sunucu kullanıcı adlarını **kalıcı X kullanıcı ID'lerine** çevirir ve bu eşleşmeyi imzalar (attestation). Kontrat imzayı doğrulamadan coin'i oluşturmaz.
   - Böylece bir hesap adını değiştirse de kazancı ID'ye bağlı kalır ve kimse başkasının hesabını sahte bir ID ile listeleyemez.
2. **Bonding curve:** Coin, sanal rezervli x·y=k eğrisinde ETH ile alınıp satılır (pump.fun modeli). Her işlemde **%1 fee** kesilir: %80'i X hesaplarına, %20'si protokole gider.
3. **PonSwap'a mezuniyet:** Eğrideki 793.1M token satılınca (yaklaşık 4.25 ETH) toplanan ETH ve ayrılmış 206.9M token, kontratın **dahili AMM havuzuna** geçer.
   - Havuzun likiditesi sonsuza kadar kilitlidir.
   - İşlemler aynı sayfada, aynı fee paylaşımıyla devam eder.
   - Harici bir DEX'e bağımlılık yoktur.
4. **Claim:** Hesap sahibi `/claim` sayfasında X ile giriş yapar. Sunucu, o hesabın ID'si için hedef cüzdana bağlı ve 15 dakika geçerli bir imza üretir. `FeeVault.claim` birikmiş ETH'yi bu cüzdana gönderir.
5. **Grafik ve işlem geçmişi:** Her işlem zincir üstüne kaydedilir. Mum grafiği, işlem listesi ve canlı işlem şeridi indexer gerektirmeden doğrudan kontrattan okunur.

### Güvenlik notları

- Launch attestation'ı ve claim imzaları aynı `SIGNER_PRIVATE_KEY` ile atılır. Bu anahtar yalnızca sunucuda durmalı ve deployer anahtarından ayrı olmalı. Sızarsa kontrat sahibi `FeeVault.setSigner` ile değiştirir.
- Attestation, coin'i oluşturan adrese bağlıdır ve 30 dakikada geçerliliğini yitirir.
- X ID çözümlemesi resmi X API ile (`X_BEARER_TOKEN`, ücretli Basic plan) ya da ücretsiz, gayriresmî `api.fxtwitter.com` üzerinden yapılır. İkincisi "best effort" çalışır; ciddi kullanımda resmi API önerilir.
- Kontratlar denetimden (audit) geçmedi. Mainnet öncesinde audit ve hukuki kontrol şart.

## Testnet'e çıkış (adım adım)

Robinhood Chain testnet: chain id `46630`, RPC `https://rpc.testnet.chain.robinhood.com`, explorer https://explorer.testnet.chain.robinhood.com, faucet https://faucet.testnet.chain.robinhood.com

**1. İki cüzdan hazırla**
```bash
cd contracts && npm install
node scripts/new-wallet.js   # CLAIM SIGNER: private key → web'de SIGNER_PRIVATE_KEY, adres → CLAIM_SIGNER_ADDRESS
```
Deployer için ayrı bir cüzdan kullan ve faucet'ten test ETH al.

**2. Kontratları deploy et.** İki yoldan birini seç:
- **GitHub Actions ile (önerilen):**
  - Settings → Secrets and variables → Actions altına şunları ekle:
    - secret `DEPLOYER_PRIVATE_KEY`
    - variable `CLAIM_SIGNER_ADDRESS`
    - istersen variable `OWNER_ADDRESS`
  - Actions → **Deploy contracts** → Run workflow → `robinhoodTestnet`.
  - Adresler job özetinde görünür.
- **Kendi bilgisayarından:**
  ```bash
  DEPLOYER_PRIVATE_KEY=0x... CLAIM_SIGNER_ADDRESS=0x... npx hardhat run scripts/deploy.js --network robinhoodTestnet
  ```
  Adresler `contracts/deployments/robinhoodTestnet.json` dosyasına yazılır.

**3. X uygulaması aç** (https://developer.x.com → Projects & Apps)
- User authentication settings: **OAuth 2.0**, tip **Web App**
- Callback URL: `https://<site-adresin>/api/auth/callback/twitter`
- Client ID ve Client Secret'ı not al. İstersen Basic plan için `X_BEARER_TOKEN` da al.

**4. Web uygulamasını Vercel'e deploy et**
- https://vercel.com/new adresinde bu repoyu import et. **Root Directory: `web`**.
- Environment Variables ekranına `web/.env.example` dosyasındaki değerleri gir. En azından şunlar gerekli:

  | Değişken | Değer |
  |---|---|
  | `NEXT_PUBLIC_CHAIN` | `testnet` |
  | `NEXT_PUBLIC_LAUNCHPAD_ADDRESS`, `NEXT_PUBLIC_FEE_VAULT_ADDRESS` | 2. adımdan |
  | `SIGNER_PRIVATE_KEY` | 1. adımdan |
  | `NEXTAUTH_URL` | `https://<site-adresin>` |
  | `NEXTAUTH_SECRET` | `openssl rand -base64 32` çıktısı |
  | `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET` | 3. adımdan |
  | `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | opsiyonel (mobil cüzdanlar için), https://cloud.reown.com |
  | `PINATA_JWT` | opsiyonel (görsel yükleme için) |

**5. Kontrol et.** `https://<site-adresin>/api/config` şunu döndürmeli: `signer: true`, `xLogin: true`. Ardından cüzdanı bağla, bir coin çıkar, al/sat yap ve `/claim` sayfasından X ile giriş yapıp claim et.

## Geliştirme

```bash
# kontratlar
cd contracts && npm install
npm test                  # 19 test
npm run export-abi        # ABI'leri web/src/lib/abi.ts dosyasına yazar

# yerel uçtan uca deneme (gerçek zincir ve X hesabı gerekmez)
npx hardhat node                                            # terminal 1
npx hardhat run scripts/local-demo.js --network localhost   # terminal 2: 4 örnek coin + işlemler
cd ../web && cp .env.example .env.local                     # sonra düzenle:
#   NEXT_PUBLIC_CHAIN=local, demo çıktısındaki adresler, X_RESOLVER=mock,
#   ENABLE_DEV_LOGIN=true, SIGNER_PRIVATE_KEY=<Hardhat #1 anahtarı>
npm install && npm run dev
```

`ENABLE_DEV_LOGIN` yalnızca `X_RESOLVER=mock` iken çalışır. Claim sayfasına sahte bir "Dev login" ekler ve production'da kapalı kalır.

## Parametreler

Kontrat sahibi bu değerleri `setFees` ve `setCurveConfig` ile değiştirebilir. Değişiklikler yeni coin'lere uygulanır.

| Parametre | Varsayılan |
|---|---|
| İşlem fee'si | %1 (en fazla %5) |
| Fee'nin protokol payı | %20 (kalan %80 X hesaplarına) |
| Oluşturma ücreti / mezuniyet ücreti | 0 / %0 (en fazla %10) |
| Sanal ETH / sanal token | 1.5 ETH / 1.073B |
| Eğri arzı / havuz arzı | 793.1M / 206.9M (toplam 1B) |

## Tasarım

Arayüz, Apple'ın sade düzenini (açık gri zemin, büyük tipografi, buzlu cam navigasyon, 24px kartlar) pump.fun'ın oyunbazlığıyla (canlı işlem şeridi, "King of the hill", yoğun coin ızgarası) birleştiriyor.

İllüstrasyonlar "chunky sticker" tarzında: düz parlak renkler, kalın yuvarlak mürekkep konturlar ve sert ofset gölgeler. Logo çapraz ikiye bölünmüş bir coin. Görseli olmayan her coin, adresinden türetilen benzersiz bir sticker avatar alır. Tüm çizimler `web/src/components/art/` altında SVG React bileşenleri olarak durur. Açık ve karanlık mod desteklenir.
