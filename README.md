<p align="center"><img src="public/hero.svg" width="480" alt="PonSplit"></p>

# PonSplit

**Tek coin, birden fazla X hesabı, fee'ler otomatik bölünür.** Robinhood Chain üzerinde bir coin çıkar. Her al/sat işleminden kesilen fee, seçtiğin X (Twitter) hesapları arasında paylaştırılır. Bu hem bonding curve aşamasında hem de coin "mezun olduktan" sonra geçerli. Hesap sahipleri X ile giriş yapıp paylarını istedikleri cüzdana çeker.

```
src/, public/   Next.js 14 web uygulaması (repo kökü: Vercel ek ayar istemez)
contracts/      Solidity (Hardhat): SplitLaunchpad, FeeVault, SplitToken
.github/        CI, tek tıkla kontrat deploy'u, ağ keşif workflow'u
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
4. **Claim:** Hesap sahibi `/claim` sayfasında hesabın kendisine ait olduğunu kanıtlar. İki yol var:
   - **Varsayılan, X geliştirici hesabı gerekmez:** Kullanıcı tek kullanımlık bir kod içeren bir post atıp linkini yapıştırır. Kod, kullanıcı adına, cüzdana ve güne bağlı bir HMAC'tir; başkası kopyalasa bile ödeme yalnızca post sahibinin cüzdanına gider.
   - **Opsiyonel:** X anahtarları verilirse "Sign in with X" (OAuth).

   - Post ile doğrulama katıdır. Post, hesabın kendi attığı yeni bir post olmalı ve metni tam olarak gösterilen metin olmalı: hedef cüzdanın tam adresi ile kod. Yanıtlar, alıntılar ve kodu sadece içeren postlar sayılmaz.

   Ardından sunucu o hesabın ID'si için hedef cüzdana bağlı, 15 dakika geçerli bir imza üretir ve `FeeVault.claim` birikmiş ETH'yi bu cüzdana gönderir.
5. **Grafik ve işlem geçmişi:** Her işlem zincir üstüne kaydedilir. Mum grafiği, işlem listesi ve canlı işlem şeridi indexer gerektirmeden doğrudan kontrattan okunur.

### Güvenlik notları

- Kontratlar deploy edildikten sonra `/setup` sayfasının gösterdiği `NEXT_PUBLIC_FEE_VAULT_ADDRESS` ve `NEXT_PUBLIC_LAUNCHPAD_ADDRESS` değerlerini barındırma ayarlarına ekle. Böylece imza anahtarı değişse bile site aynı kontratlara bakar.
- Launch attestation'ı ve claim imzaları aynı `SIGNER_PRIVATE_KEY` ile atılır. Bu anahtar yalnızca sunucuda durmalı ve deployer anahtarından ayrı olmalı. Sızarsa kontrat sahibi `FeeVault.setSigner` ile değiştirir.
- Attestation, coin'i oluşturan adrese bağlıdır ve 30 dakikada geçerliliğini yitirir.
- X ID çözümlemesi resmi X API ile (`X_BEARER_TOKEN`, ücretli Basic plan) ya da ücretsiz, gayriresmî `api.fxtwitter.com` üzerinden yapılır. İkincisi "best effort" çalışır; ciddi kullanımda resmi API önerilir.
- Kontratlar denetimden (audit) geçmedi. Mainnet öncesinde audit ve hukuki kontrol şart.

## Mainnet

Mainnet kontrol listesi, deploy adımları ve acil durum planı için bkz. **[MAINNET.md](MAINNET.md)**. Her push'ta CI; testleri, Slither'ı ve gerçek testnet/mainnet üzerindeki yaşam döngüsü simülasyonunu çalıştırır.

## Testnet'e çıkış (en kolay yol: Render)

1. https://render.com/deploy?repo=https://github.com/furkan3152/ponsplit bağlantısını aç → GitHub ile giriş → **Apply**.
   - `render.yaml` servisi kendisi kurar.
   - Yönetici anahtarı Render'ın ürettiği `SIGNER_SEED` değerinden türetilir. Kimse bir anahtar kopyalamaz.
2. Site açılınca **/setup** sayfasına git → adresi kopyala → **Open faucet** → test ETH iste.
3. **Deploy contracts** butonuna bas. Hepsi bu.

Yönetici anahtarının kendisi `keccak256("ponsplit-admin:" + SIGNER_SEED)` değeridir. `SIGNER_SEED` Render panelinde saklanır; kontrat sahibi işlemleri için bu değerden türetilir.

## Alternatif: Vercel

Robinhood Chain testnet: chain id `46630`, explorer https://explorer.testnet.chain.robinhood.com

1. **Siteyi yayınla.** https://vercel.com/new → GitHub ile giriş → `ponsplit` reposunu **Import** → **Deploy**. Hiçbir ayar gerekmiyor. Site açılır ve "Finish setup" uyarısı gösterir.
2. **`/setup` sayfasını aç** → **Generate admin key**.
   - Anahtar tarayıcıda üretilir ve kimseye gönderilmez.
   - Kopyala → Vercel → Settings → Environment Variables → `SIGNER_PRIVATE_KEY` olarak ekle → Deployments → **Redeploy**.
   - Anahtarı güvenli bir yere de kaydet. Kontratların sahibi ve imzalayıcısı bu anahtar.
3. **Test ETH al.** `/setup` sayfasında adresi kopyala → **Open faucet** → yapıştır.
4. **Deploy contracts** butonuna bas. Sunucu 3 işlem gönderir (FeeVault, SplitLaunchpad, bağlama).
   - Kontrat adresleri anahtarın adresinden önceden hesaplandığı için yeniden build gerekmez.
   - Site hemen çalışmaya başlar.

Bundan sonra coin çıkarma, al/sat, grafik ve post ile claim çalışır. Tek anahtarın rolleri: deploy eden, kontrat sahibi ve launch/claim imzalayıcısı. Mainnet'te bu rolleri ayır.

**Alternatif:** GitHub'da `ADMIN_PRIVATE_KEY` secret'ı tanımlanırsa Actions → **Deploy contracts** workflow'u aynı deploy'u yapar. Workflow ayrıca Blockscout doğrulaması ve smoke test çalıştırır, adresleri `src/deployment.json` dosyasına commit'ler.

Opsiyonel ortam değişkenleri `.env.example` dosyasında:
- `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET`: "Sign in with X" için
- `X_BEARER_TOKEN`: resmi X API ile ID çözümleme için
- `PINATA_JWT`: görsel yükleme için
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`: mobil cüzdanlar için

## Geliştirme

```bash
# kontratlar
cd contracts && npm install
npm test                  # 27 test
npm run export-abi        # ABI'leri src/lib/abi.ts dosyasına yazar

# yerel uçtan uca deneme (gerçek zincir ve X hesabı gerekmez)
npx hardhat node                                            # terminal 1
npx hardhat run scripts/local-demo.js --network localhost   # terminal 2: 4 örnek coin + işlemler
cd .. && cp .env.example .env.local                         # sonra düzenle:
#   NEXT_PUBLIC_CHAIN=local, demo çıktısındaki adresler, X_RESOLVER=mock,
#   ENABLE_DEV_LOGIN=true, SIGNER_PRIVATE_KEY=<Hardhat #1 anahtarı>
npm install && npm run dev
```

`X_RESOLVER=mock` modunda claim sayfasındaki post linki yerine `mock:<kullanıcı-adı>` yazılabilir. `ENABLE_DEV_LOGIN=true` ise sahte bir "Dev login" ekler. İkisi de production'da kapalı kalır.

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

İllüstrasyonlar "chunky sticker" tarzında: düz parlak renkler, kalın yuvarlak mürekkep konturlar ve sert ofset gölgeler. Logo çapraz ikiye bölünmüş bir coin. Görseli olmayan her coin, adresinden türetilen benzersiz bir sticker avatar alır. Tüm çizimler `src/components/art/` altında SVG React bileşenleri olarak durur. Açık ve karanlık mod desteklenir.
