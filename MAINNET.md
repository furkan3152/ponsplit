# Kurulum ve mainnet'e çıkış

## Otomatik olarak doğrulananlar (her push'ta CI)

| Kontrol | Ne yapıyor |
|---|---|
| `contracts` | 27 birim testi, **gerçek kod** üzerinde: doğrulanmış kaynaklardan derlenen Uniswap v4, Permit2 ve pons v2 kopyası. Launch, platform payı, creator vergisi, snipe vergisi, eğri ve havuz fee'lerinin bölünmesi, mezuniyet, router, claim ve `collectAndClaim`, yetki kontrolleri. Ayrıca `vendor/out`'un kaynaklardan birebir derlendiği ve sitenin ABI/bytecode'unun güncel olduğu kontrol edilir. |
| `security` | Slither statik analizi; orta ve üstü seviyede bulgu çıkarsa build kırılır. |
| `pons-fork` (mainnet) | Robinhood mainnet fork'unda **gerçek pons** ile: vendor'daki pons kodunun zincirdekiyle bayt bayt aynı olduğu, launch + ilk alım, pons'un fiyat formülü, fee bölüşümü, iki aşamalı mezuniyet, Uniswap v4 havuzunda router işlemleri, mezuniyet sonrası fee'ler. |
| `pons-fork` (testnet) | Testnet fork'unda pons kopyası `/setup`'ın yaptığı gibi kurulur ve aynı akış çalıştırılır. |
| `web` | Typecheck, lint, birim testleri ve production build. |
| `e2e` (testnet, mainnet) | Her ağın fork'unda production build, gerçek tarayıcı, birden çok cüzdan: `/setup`'tan cüzdanla deploy (testnet 19, mainnet 3 işlem; çift dokunuşta bile her işlem bir kez), yenilemede kaldığı yerden devam, adreslerin sabitlenmesi, **gerçek X hesaplarıyla** (@jack, @x) arayüzden launch, eğride al/sat, mezuniyet ve havuzun coin sayfasından açılması, havuzda al/sat, fee bölüşümü, sahip panelinden durdurma/devam ve SplitEarn payını çekme, claim sayfası, üstteki ağ seçici, 8 sayfa masaüstü/mobil/açık tema taşma kontrolü. |

## Mainnet öncesi yapılması gerekenler

Bu adımları kod çözemez; karar ve sorumluluk proje sahibinde.

1. **Bağımsız güvenlik denetimi (audit).** SplitEarn kontratları gerçek para yönlendirecek. Otomatik testler ve Slither bir denetimin yerini tutmaz.
2. **Hukuki kontrol.** Token launchpad'leri birçok ülkede düzenlemeye tabi. Herkes herhangi bir X hesabını listeleyebilir; site bunun bir onay olmadığını söylüyor, ama taklit ve şikâyet durumları için bir kaldırma süreci planla (gizli coin listesi: `src/deployment.json` → `hidden`).
3. **Roller.**
   - **Sahip:** kontratları kendi cüzdanınla deploy edersin, sahibi baştan sensin. Durdurma, imza anahtarını değiştirme ve SplitEarn payını çekme yetkisi bu cüzdandadır. Özel anahtarı cüzdandan hiç çıkmaz.
   - **İmza anahtarı** (`SIGNER_PRIVATE_KEY`): sunucuda durur ve yalnızca launch ve claim imzalar. Para tutmaz, hiçbir kontratın sahibi değildir. `/setup`'ta tarayıcında üretilir, yalnızca barındırma paneline yapıştırılır; hiçbir sohbete ya da dosyaya yazılmaz. İki ağda da aynı anahtar kullanılır.
4. **X doğrulaması.**
   - "Sign in with X" (OAuth) için: `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`, `NEXTAUTH_URL=https://<site-adresin>`; X uygulamasına `https://<site-adresin>/api/auth/callback/twitter` callback olarak kaydedilir.
   - Kullanıcı adını ID'ye çevirmek için resmi API önerilir: `X_BEARER_TOKEN`. Launch'lar bu API'yi kullanır (dakikada en fazla `X_API_CALLS_PER_MIN`, `src/lib/x.ts`); dolarsa o dakika ücretsiz aynadan çözülür, durmaz.
   - Sınırlar istemci başınadır (IP; IPv6'da /64 ve /48). Launch ve claim için ortak bir üst sınır yok: birkaç adresten gelen yoğun istek başkalarını durduramaz.
5. **Altyapı.**
   - Site Vercel'de çalışır. Vercel'in ücretsiz (Hobby) planı ticari kullanıma izin vermez; gerçek kullanıcılardan önce **Pro** plana geç.
   - Kendi alan adını bağla (Vercel → Settings → Domains).
   - Özel RPC sağlayıcısı: `NEXT_PUBLIC_MAINNET_RPC_URL` (ve istersen `NEXT_PUBLIC_TESTNET_RPC_URL`). Herkese açık RPC hız sınırlı.
   - Mobil cüzdanlar için `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.
6. **SplitEarn'ün ayarları.** Sahip, SplitEarn'ün payını (`setPlatformShareBps`, en fazla creator payının %30'u) ve kullanılan pons launch ayarını (`setLaunchConfigId`) değiştirebilir. Her değişiklik `termsVersion`'ı artırır; arayüz kullanıcının gördüğü koşulların sürümünü launch'a ekler, koşullar imza sırasında değişirse launch geri çevrilir. Var olan coin'ler launch anındaki oranlarını korur.

## Kurulum adımları (telefondan)

1. **Site.** Vercel projesi bu repodan build edilir; her push'ta kendiliğinden yeniden deploy olur. Tek site iki ağı da sunar.
2. **İmza anahtarı.** Siteyi aç → `/setup` → **Generate signing key** → **Copy**.
   - Vercel → proje → **Settings → Environment Variables** → `SIGNER_PRIVATE_KEY` olarak yapıştır (Sensitive) → Save.
   - Aynı yere `ADMIN_ADDRESSES` = kendi cüzdan adresin (0x…; gizli değildir) → Save → **Deployments → ⋯ → Redeploy**. `/setup` yalnızca bu cüzdana (ve deploy sonrası kontratların sahibine) açılır: **Admin sign-in** → cüzdanı bağla → mesajı imzala.
3. **Ağı seç.** Sayfanın üstündeki **Main / Test** seçicisinden kurulacak ağı seç.
4. **Deploy.** `/setup`'ı cüzdan uygulamanın tarayıcısında aç (MetaMask, Rabby…) ve bağlan → **Deploy**.
   - **Testnet:** 19 işlem. Önce pons kopyası (7 kontrat + 9 bağlantı: pons'un mainnet ayarları, %1 fee, 4,2 ETH mezuniyet, 3 saniyelik snipe vergisi), sonra SplitEarn (FeeVault, launcher, bağlantı). Gas için faucet: https://faucet.testnet.chain.robinhood.com
   - **Mainnet:** 3 işlem (FeeVault, launcher, bağlantı); coin'ler gerçek pons'ta çıkar.
   - Her işlemi cüzdan ayrı ayrı sorar. Sayfa yarıda kapanırsa tekrar aç: yapılanları zincirden bulur ve kaldığı yerden devam eder, hiçbir şeyi iki kez göndermez.
   - Testnet'te cüzdanın pons kopyasının launch ücretini alır; cüzdan düz ETH transferini reddediyorsa sayfa uyarır.
5. **Adresleri sabitle.** `/setup`, `src/deployment.json` için bir JSON parçası ve karşılık gelen ortam değişkenlerini gösterir. Ya JSON'u repoya yazdır (push'la Vercel yeniden build eder), ya da değişkenleri Vercel'e ekleyip Redeploy et. Site bundan sonra o ağda canlıdır ve `/setup` sahip panelini gösterir.
6. **Zincirden doğrula.** GitHub → Actions → **Inspect deployment** → Run workflow: `network`, `launcher` adresi, `owner` olarak kendi cüzdan adresin, `signer` olarak `/api/config`'in gösterdiği adres ve istersen `site`. İş kontratları doğrudan zincirden okur; `site` verilirse sitenin gerçek X hesaplarıyla imzaladığı bir launch'ı `eth_call` ile dener. Hiçbir işlem gönderilmez.

## Acil durum planı

Hepsi sahip cüzdanından yapılır. Çoğu, `/setup` sayfasındaki **Owner controls** panelinde tek dokunuştur (önce üstten doğru ağı seç).

| Durum | Ne yapılır |
|---|---|
| Sunucu imza anahtarı sızdı | 1) Her iki ağda **Pause claims** (`FeeVault.setClaimsPaused(true)`). 2) Vercel'de `SIGNER_PRIVATE_KEY`'i sil → Redeploy. 3) `/setup` → **Generate signing key** → Vercel'e ekle → Redeploy. 4) Her iki ağda **Use this site's key** (`FeeVault.setSigner(yeni)`). 5) **Resume claims**. Bakiyeler durdurma sırasında yerinde kalır; eski imzalar geçersizleşir. |
| Kötüye kullanım / spam coin dalgası | **Pause launches** (`SplitEarnLauncher.setLaunchesPaused(true)`). Var olan coin'ler pons'ta işlem görmeye devam eder; kimsenin parası kilitli kalmaz. Coin'i listeden gizlemek için adresini `src/deployment.json` → `hidden`'a ekle. |
| SplitEarn gelirini çekmek | **Withdraw to this wallet** (`SplitEarnLauncher.withdrawPlatformFees`). Coin'lerin fee'leri claim'lerle ya da herhangi birinin `collectMany` çağrısıyla toplanır. |
| Sahipliği devretmek | `transferOwnership(yeni)` → yeni adres `acceptOwnership()` (iki adımlı; launcher, FeeVault ve testnet'te pons kopyası ayrı ayrı). |

## Tasarım gereği güven varsayımları

- **İmzalayıcı:** Kullanıcı adı → X ID eşleşmesini ve claim yetkisini imzalayan sunucuya güvenilir. İmzalayıcı ele geçirilirse biriken claim'ler yönlendirilebilir; yukarıdaki plan bu riski sınırlar.
- **pons:** Coin'ler pons'un kurallarına tabidir. pons'un fee oranları coin başına launch anında sabitlenir; pons'un topluluk devri (CTO) akışı bir coin'in creator fee alıcısını değiştirebilir, coin sayfası bunu gösterir.
- **X doğrulaması:** Post ile doğrulama fxtwitter üzerinden okunur; OAuth, X'in kendi doğrulamasını kullanır.
- **Fiyatlar ETH cinsinden gösterilir;** USD için bir fiyat kaynağı (oracle) yok.
