# Mainnet'e çıkış

## Otomatik olarak doğrulananlar (her push'ta CI)

| Kontrol | Ne yapıyor |
|---|---|
| `contracts` | 27 birim testi: fee dağıtımı, eğri, mezuniyet, havuz, claim, imza reddi, sahiplik, durdurma, launch ücreti sınırı, launch koşullarının sürümle sabitlenmesi. Ayrıca `/setup`'ın deploy ettiği bytecode'un kaynak koddan derlenenle birebir aynı olduğu kontrol edilir. |
| `security` | Slither statik analizi; orta ve üstü seviyede bulgu çıkarsa build kırılır |
| `chain-simulation` | Tüm yaşam döngüsü **gerçek Robinhood Chain testnet ve mainnet** üzerinde tek bir `eth_call` ile çalıştırılır: deploy, launch, eğride al/sat, mezuniyet, havuzda al/sat, imzalı claim. Hiçbir işlem gönderilmez, hiçbir şey harcanmaz. Mainnet'te toplam maliyet yaklaşık 7,9M gas. |
| `web` | Typecheck, lint, birim testleri (fiyat gösterimi, görsel boyut kontrolü, IP anahtarları) ve production build |
| `chain-simulation` (derin) | Yine tek `eth_call` ile gerçek testnet ve mainnet üzerinde: 16 ayrı trader hesabı, 3 coin (biri 10 X hesabına bölünmüş), rastgele 120 adımlık al/sat fırtınası, her adımdan sonra ödeme gücü ve arz kontrolü, mezuniyet, havuz işlemleri, reddedilmesi gereken 6 saldırı (fazla satış, bilinmeyen token, slippage, claim yönlendirme, sahte ve tekrar kullanılan imza) ve her X hesabının tam payını claim etmesi. |
| `e2e-fork` | Robinhood testnet'in fork'u üzerinde production build gerçek bir tarayıcıda, birden çok cüzdanla uçtan uca test edilir: /setup deploy ve sahiplik devri, gerçek X hesabı çözümleme (@jack → 12), arayüzden launch, al/sat, mezuniyet, havuz işlemleri, post ile claim, 8 sayfa masaüstü/mobil/karanlık modda taşma ve hata kontrolü. Ekran görüntüleri artifact olarak yüklenir. |
| `e2e-wallet-setup` | Mainnet'teki kurulum yolu: sahip, kontratları /setup'tan kendi cüzdanıyla deploy eder (tam 3 işlem). Sayfa yenilenince tekrar deploy teklif edilmez. Site adresler sabitlenmiş hâliyle yeniden build edilir; sahipliğin cüzdanda olduğu, imza anahtarının eşleştiği ve bir launch'ın çalıştığı kontrol edilir. |

## Mainnet öncesi yapılması gerekenler

Bu adımları kod çözemez; karar ve sorumluluk proje sahibinde.

1. **Bağımsız güvenlik denetimi (audit).** Kontratlar gerçek para tutacak. Otomatik testler ve Slither bir denetimin yerini tutmaz.
2. **Hukuki kontrol.** Token launchpad'leri birçok ülkede düzenlemeye tabi. Ayrıca herkes herhangi bir X hesabını listeleyebilir; site bunun bir onay olmadığını gösteriyor, ama taklit ve şikâyet durumları için bir kaldırma süreci planla.
3. **Rolleri ayır.**
   - **Sahip:** kontratları kendi cüzdanınla deploy edersin, sahibi baştan sensin. Durdurma, ücret ayarı ve imza anahtarını değiştirme yetkisi bu cüzdandadır. Özel anahtarı cüzdandan hiç çıkmaz.
   - **İmza anahtarı** (`SIGNER_PRIVATE_KEY`): sunucuda durur ve yalnızca launch ve claim imzalar. Para tutmaz, kontratların sahibi değildir. `/setup`'ta tarayıcında üretilir, yalnızca Vercel'e yapıştırılır; hiçbir sohbete ya da dosyaya yazılmaz.
4. **X doğrulaması.**
   - Mainnet'te "Sign in with X" (OAuth) açılmalı: `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`.
   - `NEXTAUTH_URL=https://<site-adresin>` ekle ve X uygulamasına `https://<site-adresin>/api/auth/callback/twitter` adresini callback olarak kaydet. Yoksa X kullanıcıyı yanlış adrese döndürür ve giriş başarısız olur.
   - Kullanıcı adını ID'ye çevirmek için resmi API kullanılmalı: `X_BEARER_TOKEN`. Launch'lar bu API'yi kullanır; önizlemeler (yazarken görünen avatarlar) ücretsiz aynadan gelir.
   - Sınırlar istemci başınadır (IP; IPv6'da /64, ayrıca /48 ağı başına). Launch'lar ve claim'ler için ortak bir üst sınır yok; yani birkaç adresten gelen yoğun istek başkalarının launch'ını ya da claim'ini durduramaz. Kötüye kullanım en fazla kendi adresinin kotasını bitirir.
   - Sunucu X API'yi dakikada en fazla 60 kez çağırır (her çağrı bir launch'ın tüm hesaplarını çözer). Bu sınır dolarsa ya da X hız sınırı koyarsa launch'lar o dakika aynadan çözülür; durmaz. Sınırı `src/lib/x.ts` içindeki `X_API_CALLS_PER_MIN` belirler; X API planının maliyetine göre ayarla.
   - Varsayılan fxtwitter aynası ücretsiz ama gayriresmî.
   - Post ile doğrulama katıdır. Post, hesabın kendi attığı yeni bir post olmalı (yanıt, alıntı ya da repost olamaz). Metni de tam olarak şu olmalı: hedef cüzdanın tam adresi ve tek kullanımlık kod. Kodu sadece içeren postlar reddedilir. Bu sayede @grok gibi otomatik yanıt veren ya da metni tekrarlayan hesaplar üzerinden başkasının fee'si çekilemez.
5. **Altyapı.**
   - Site Vercel'de çalışır. Vercel'in ücretsiz (Hobby) planı ticari kullanıma izin vermez; bu site ücret aldığı için gerçek kullanıcılardan önce **Pro** plana geç.
   - Kendi alan adını bağla (Vercel → Settings → Domains).
   - Özel bir RPC sağlayıcısı kullan: `NEXT_PUBLIC_RPC_URL`. Herkese açık RPC hız sınırlı.
   - Coin listesi, arama ve portföy tüm coin'leri doğrudan kontrattan 60'lık sayfalar hâlinde okur. Her sayfa ayrı bir `eth_call`'dır; Multicall ile birleştirilmez, böylece düğümün gas sınırına takılmaz. Birkaç bin coin'e kadar bu yeterli. Daha büyük ölçekte bir indexer (ör. TokenCreated/Trade event'lerini okuyan bir servis) ekle.
   - Rate limit istemci IP'sini Vercel'de `x-vercel-forwarded-for` başlığından, Render'da Cloudflare'in yazdığı `cf-connecting-ip` başlığından alır. Başka bir barındırmada `TRUSTED_IP_HEADER` ayarla.
   - Sınırlar ve önbellekler sunucu belleğinde tutulur. Vercel'de her fonksiyon örneğinin kendi belleği olur, yani sınırlar örnek başınadır. Başlangıç için yeterli; yoğun kötüye kullanım görürsen Vercel Firewall'da rate limit kuralı ekle.
   - Mobil cüzdanlar için `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` ekle.
6. **Parametreleri gözden geçir.** Deploy sonrası sahip `setFees` / `setCurveConfig` ile değiştirebilir. Değişiklikler yalnızca yeni coin'lere uygulanır.

   | Parametre | Varsayılan | Sınır |
   |---|---|---|
   | İşlem fee'si | %1 | en fazla %5 |
   | Protokol payı | fee'nin %20'si | en fazla %50: X hesapları her zaman en az yarıyı alır |
   | Mezuniyet ücreti | %0 | en fazla %10 |
   | Oluşturma ücreti | 0 | en fazla 0,1 ETH |

   Her ücret ya da eğri değişikliği `termsVersion` değerini artırır. Arayüz, kullanıcıya gösterdiği koşulların sürümünü launch işlemine ekler. Kullanıcı imzalarken koşullar değişirse launch geri çevrilir; coin her zaman kullanıcının gördüğü koşullarla oluşturulur.

## Mainnet deploy (Vercel + kendi cüzdanın)

1. **Vercel projesi** `NEXT_PUBLIC_CHAIN=mainnet` ile bu repodan build edilir; her push'ta kendiliğinden yeniden deploy olur.
2. **İmza anahtarı.** Siteyi aç → `/setup` → **Generate signing key** → **Copy**.
   - Vercel → proje → **Settings → Environment Variables** → `SIGNER_PRIVATE_KEY` olarak yapıştır (Sensitive) → Save.
   - **Deployments → ⋯ → Redeploy.**
   - Anahtarı yalnızca Vercel'e yapıştır; hiçbir sohbete yazma.
3. **Deploy.** `/setup`'ı cüzdan uygulamanın tarayıcısında aç (MetaMask, Rabby, Coinbase Wallet…) ve bağlan.
   - **Deploy (3 transactions)** → üç işlemi onayla: FeeVault, SplitLaunchpad ve ikisini birbirine bağlama.
   - Cüzdanda gas için biraz ETH olmalı (Robinhood Chain mainnet).
   - Sayfa yarıda kapanırsa tekrar aç: yapılanları zincirden bulur ve kaldığı yerden devam eder, hiçbir şeyi iki kez deploy etmez.
4. **Adresleri sabitle.** `/setup` iki satır gösterir: `NEXT_PUBLIC_FEE_VAULT_ADDRESS=…` ve `NEXT_PUBLIC_LAUNCHPAD_ADDRESS=…`.
   - Bunları `src/deployment.json` içindeki `mainnet` kaydına yaz (push'la Vercel yeniden build eder) ya da Vercel ortam değişkeni olarak ekleyip Redeploy et.
   - Site bundan sonra bu kontratları kullanır.
5. OAuth, `NEXTAUTH_URL` ve `X_BEARER_TOKEN` ortam değişkenlerini ekle, Redeploy et (isteğe bağlı ama önerilir).
6. **Zincirden doğrula.** GitHub → Actions → **Inspect deployment** → Run workflow. `network: mainnet`, iki kontrat adresi, `owner` olarak kendi cüzdan adresin ve site adresini (`site`) gir. `admin` alanını boş bırak: kontratları sunucu değil, cüzdanın deploy etti.
   - İş, kontratları sunucuya sormadan doğrudan zincirden okur: kod, birbirine bağlılık, imzalayıcı, sahipler, ücretler.
   - `site` verilirse sitenin gerçek X hesaplarını çözüp imzaladığı bir launch'ı `eth_call` ile dener. Hiçbir işlem gönderilmez, anahtar gerekmez.

Testnet sitesi Render'da (`render.yaml`) çalışmaya devam eder. Orada kurulum, faucet'ten beslenen sunucu anahtarıyla tek dokunuşludur (`NEXT_PUBLIC_SETUP_MODE=server`, testnet'te varsayılan).

## Acil durum planı

| Durum | Ne yapılır (sahip cüzdanından) |
|---|---|
| Sunucu imza anahtarı sızdı | 1) `FeeVault.setClaimsPaused(true)`. 2) `/setup`'ta yeni bir imza anahtarı üret, Vercel'de `SIGNER_PRIVATE_KEY` değerini onunla değiştir, Redeploy et. 3) Kendi cüzdanından, `/setup`'ta görünen yeni imza adresiyle `FeeVault.setSigner(yeni)` çağır; `/setup` imzalayıcının eşleştiğini gösterir. 4) `setClaimsPaused(false)`. Bakiyeler durdurma sırasında yerinde kalır; eski imzalar geçersizleşir. |
| Kötüye kullanım / spam coin dalgası | `SplitLaunchpad.setLaunchesPaused(true)`. Mevcut coin'lerin alım satımı bilinçli olarak **durdurulamaz**, kimsenin parası içeride kilitli kalmaz. |
| Protokol gelirlerini çekmek | `SplitLaunchpad.withdrawProtocolFees(adres)` |
| Sahipliği devretmek | `transferOwnership(yeni)` → yeni adres `acceptOwnership()` (iki adımlı) |

## Tasarım gereği güven varsayımları

- **İmzalayıcı:** Kullanıcı adı → X ID eşleşmesini ve claim yetkisini imzalayan sunucuya güvenilir. İmzalayıcı ele geçirilirse biriken claim'ler yönlendirilebilir. Yukarıdaki plan bu riski sınırlar.
- **X doğrulaması:** Post ile doğrulama fxtwitter üzerinden okunur. OAuth, X'in kendi doğrulamasını kullanır.
- **Fiyatlar ETH cinsinden gösterilir;** USD için bir fiyat kaynağı (oracle) yok.
