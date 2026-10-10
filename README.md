# Tiksplit

TikTok kullanıcıları adına **Solana mainnet / pump.fun** token başlatan uygulama. Yeni token'ların pump.fun creator ücretleri **%20 platform / %80 TikTok kullanıcısının escrow hesabı** olarak kalıcı paylaşılır. Bugünkü doğrulama yolu **kullanıcının yayınladığı TikTok videosunun admin tarafından elle incelenmesidir**; TikTok developer uygulaması veya API anahtarı gerektirmez. Next.js 14, pump.fun'ın resmi SDK'ları ve ayrı Solana escrow programı kullanılır. UseReels'in ücret tahsis mantığından yararlanılmıştır; arayüz özgündür. TikTok ve pump.fun ile resmi ortaklık yoktur.

## Akış

1. `/create`: tek TikTok kullanıcı adı, token bilgileri ve isteğe bağlı ilk alım seçilir. Cüzdan pump.fun token'ını oluşturup native fee sharing'i tamamlar. Yeni launch'ta creator ücretinin %20'si platform hazinesine, %80'i creator escrow'una gider; launcher payı yoktur. Oranlar toplam işlem tutarına veya token arzına uygulanmaz. Ayrı launch ücreti `0.01 SOL`'dur.
2. `/token/[mint]`: gerçek bonding curve / pump.fun pool verileri, alım satım ve herkesin çalıştırabildiği ücret dağıtımı. Dağıtım, biriken creator ücretlerini native pump.fun vault'undan hissedarlara gönderir. Kullanıcı henüz doğrulanmamışken de escrow'unda SOL birikebilir.
3. `/claim`: creator cüzdanıyla zincirde bir doğrulama isteği açılır. İstek kullanıcı adı, cüzdan ve rastgele **128 bit nonce** içerir; uygulama **kullanıcı adı + tam beneficiary cüzdan adresi + nonce'a bağlı tam kanıt kodunu** gösterir. Kullanıcı uygulamanın ürettiği kodun tamamını kısaltmadan **kendi TikTok hesabından yayınladığı herkese açık videonun açıklamasına veya videoda görünür biçimde** ekler. Yalnız nonce yayınlamak yeterli değildir.
4. Kullanıcı `https://www.tiktok.com/@aynı.kullanıcı/video/<id>` biçimindeki **orijinal video URL'sini** kendi cüzdanıyla imzalayarak isteğe bağlar. Başka kullanıcı adı, ekran görüntüsü veya başka profilden video sahiplik kanıtı sayılmaz.
5. Admin `/admin` üzerinden orijinal videoyu ve profili açıp **gerçek kullanıcı adı + tam cüzdan adresi içeren bütün kod + istek cüzdanı** eşleşmesini elle kontrol eder. Kanıt yeterliyse kendi cüzdanıyla zincirde onay verir. Bu otomatik TikTok/API doğrulaması veya scraper sonucu değildir.
6. Onay tek başına creator cüzdanını etkinleştirmez. İstek sahibi cüzdan son bağlama/aktivasyon işlemini imzalar; ardından yalnız o cüzdan creator escrow'undan çekim yapar. **İlk başarılı bağlama kalıcıdır.** Admin yalnız platform payını alır; creator payını admin olarak çekemez.

Doğrulama isteği **48 saat** geçerlidir. İstek sahibi iptal edip rent rezervini geri alabilir. Admin onayında proof hesabı kapanır ve rent istek sahibine döner; network işlem ücretleri geri verilmez. 143 byte proof hesabı için varsayılan yerel rent hesabı **0.00188616 SOL**'dur; ekranda mainnet RPC'den hesaplanan gerçek tutar gösterilir. Kapanan hesabın işlem geçmişi Solana'da kalır.

pump.fun'da native TikTok claim hesabı yoktur; uydurulmuş `Platform.TikTok` numarası kullanılmaz. Fee sharing pump.fun programında, kullanıcı adına birikim ve çekim `programs/tiktok-escrow` içindedir. Admin yanlış sahiplik kanıtını kabul ederse yanlış cüzdana onay verebilir; bu yüzden ilk bağlama öncesinde admin'e güvenilir. Program upgrade edilebiliyorsa upgrade authority de güvenilen taraftır. Kaynak bağımsız güvenlik denetiminden geçmiş veya kusursuz olarak sunulmaz.

## Çalıştırma ve bugünkü kurulum

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Hazine ve paylaşım `src/splidev.json` içindedir: `platformBps: 2000`, `pastPlatformBps: [1000]`. Eski `NEXT_PUBLIC_SPLIDEV_*` isimleri uyumluluk için korunur. Admin ve platform hazinesi:

`D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm`

Varsayılan manual verifier aynı admin public adresidir. **Owner'ın özel anahtarı veya seed'i uygulamaya/environment'a konmaz.** Program deployment, onay ve para işlemleri admin'in kendi cüzdanında; istek/aktivasyon/claim creator'ın cüzdanında imzalanır.

Bugün gerekenler:

| Ayar | Amaç |
| --- | --- |
| `SITE_URL` | Gerçek HTTPS public origin; path/query/hash eklenmez. |
| `NEXT_PUBLIC_TIKSPLIT_ADMIN_WALLET` | Yayınlanmış admin public adresi; cüzdan imzaları bu kimlikle karşılaştırılır. |
| `NEXT_PUBLIC_TIKSPLIT_VERIFIER` | Manual review için aynı admin public adresi. |
| `NEXT_PUBLIC_TIKSPLIT_ESCROW_PROGRAM_ID` | Güncel manual proof/approval programının gerçek mainnet public adresi. |
| `SOLANA_RPC_URL`, `NEXT_PUBLIC_SOLANA_RPC_URL` | Server/browser mainnet RPC. Mevcut üretim RPC ayarları kullanılabilir. |
| `BLOB_READ_WRITE_TOKEN` veya `PINATA_JWT` | Kalıcı görsel/metadata depolama; mevcut üretim sağlayıcısı kullanılabilir. |

`/admin` içindeki varsayılan cüzdan imzalı unlock, deployment, manual review/onay ve financial işlemler için TikTok API, harici signer veya Redis gerekmez. Sadece cüzdan bağlanması uygulamanın sahiplik kanıtını onaylamaz; her zincir işlemi yetkili cüzdandan imza ister.

`NEXT_PUBLIC_*` değerleri build sırasında browser bundle'ına girer; değiştiklerinde production rebuild gerekir. RPC server token'ı, depolama credential'ı veya session/Vercel secret'ı bu prefix ile tanımlanmaz.

Sıralı deployment ve gerçek video testi [docs/launch-checklist.md](docs/launch-checklist.md) dosyasındadır. Web yayını, mainnet programın deploy edildiği veya creator claim'inin canlıda denendiği anlamına gelmez. **Gerçek creator hesabından yayınlanan kodlu video → admin review → owner aktivasyonu → küçük tutarlı mainnet claim** tamamlanmadan bu akışın canlı doğrulandığı söylenmez.

## İsteğe bağlı server admin ve Vercel otomasyonu

Program public ayarlarını Vercel'e elle girip rebuild yapmak mümkündür. Admin panelinin korumalı **server environment mutation / otomatik Vercel rebuild** yolunu kullanmak için ayrıca:

- Güvenilen `SITE_URL` origin'i ve en az 32 byte rastgele `ADMIN_SESSION_SECRET` gerekir. Kod `TIKTOK_SESSION_SECRET` fallback'ini de destekler; ayrı secret önerilir.
- Production'da `ADMIN_REPLAY_REDIS_REST_URL` + `ADMIN_REPLAY_REDIS_REST_TOKEN` gerekir; server oturum/challenge replay kontrolü ortak store'dadır. Bunlar varsayılan on-chain manual review için zorunlu değildir.
- İsteğe bağlı `VERCEL_DEPLOY_TOKEN`, `VERCEL_PROJECT_ID` ve gerekiyorsa `VERCEL_TEAM_ID` yalnız server'da tutulur. Token browser'a veya API yanıtına gönderilmez.

## TikTok OAuth — sonraki isteğe bağlı entegrasyon

Mevcut Login Kit adaptörü bugünkü manual proof akışının ön koşulu değildir. Otomatik OAuth yolunu daha sonra kullanmak için TikTok uygulaması ve `user.info.basic` + `user.info.profile` scope'ları onaylanmalı, production client key/secret, aynı public origin'deki `/api/tiktok/callback`, en az 32 byte `TIKTOK_SESSION_SECRET` ve gerçek harici attestation signer hizmeti yapılandırılmalıdır. Owner cüzdan özel anahtarı bir signer servisine yüklenmez.

TikTok review; tam geliştirilen public site, menü açmadan görülebilen aktif Privacy/Terms bağlantıları, URL ownership doğrulaması ve ilk review'da sandbox uçtan uca demo ister. Başvurunun kabulü garanti edilmez. Resmi kaynaklar: [Login Kit Web](https://developers.tiktok.com/doc/login-kit-web), [scope listesi](https://developers.tiktok.com/doc/tiktok-api-scopes/), [app review](https://developers.tiktok.com/doc/app-review-guidelines/), [app kaydı](https://developers.tiktok.com/doc/getting-started-create-an-app).

Program/verifier adresinin değiştirilmesi yeni escrow PDA'ları üretir; final coin alıcılarını taşımaz. OAuth/signer kurulumuna geçerken mevcut manual vault'ların claim yolunu ve eski verifier bağlantısını korumak gerekir.

## Maliyet — 10 Ekim 2026

| Kalem | Tahmin / kaynak |
| --- | --- |
| Mainnet program deployment | **Güncel `/admin` mainnet RPC teklifini kullanın.** Güncel 104,568 byte manual-proof build için yerel RPC tahmini final rent + fee `0.730743800 SOL`; konservatif başlangıç rezervi `1.459690480 SOL`. Bu yerel ölçüm, mainnet'teki kesin fiyat veya canlı deployment sonucu değildir. |
| Creator proof isteği | 143 byte için varsayılan yerel rent `0.00188616 SOL`; uygulama gerçek RPC tutarını gösterir. İptal/onayda rent geri döner; network ücretleri harcanır. |
| Vercel Pro | [$20/ay + kullanım aşımı](https://vercel.com/pricing). Hobby kişisel/ticari olmayan kullanım içindir. |
| RPC | Mevcut endpoint kullanılabilir; isteğe bağlı [Helius Developer $49/ay](https://www.helius.dev/pricing). Public RPC yoğun trafikte limitlenebilir. |
| Redis | Bugünkü manual verification için gerekmez. İsteğe bağlı server admin otomasyonunda [Upstash Free kota veya $0.20/100 bin komut](https://upstash.com/pricing/redis); storage/bandwidth/replica kullanımını ayrıca değerlendirin. |
| Verifier imzalayıcı | Bugünkü manual approval admin cüzdanında imzalanır; ayrı signer aboneliği gerekmez. Gelecekte OAuth attestation seçilirse sağlayıcı maliyeti ayrıdır. |
| Storage, domain, audit | Kullanıma ve sağlayıcı/denetim kapsamına göre ayrı teklif. Mevcut storage/RPC kullanılabilir. |

Yerel deployment hesabı **119 işlem** içerir: 117 write, 1 buffer create ve 1 deploy. Final tutarın `0.730138800 SOL` kısmı program hesaplarında tutulan rent, `0.000605000 SOL` kısmı işlem ücreti tahminidir. Konservatif başlangıç rezervi final tutara geçici buffer rent'i `0.728941680 SOL` ve recovery işlemi için `0.000005 SOL` ekler. Mainnet paneli güncel rent/fee değerleriyle yeniden fiyatlar.

Yalnız Vercel/RPC tabanı $20/ay; isteğe bağlı Helius Developer eklenirse $69/aydır. Storage, domain, audit ve mevcut sağlayıcıların kullanım aşımı bu toplama dahil değildir. SOL/USD kuru sabitlenmemiştir. Program rent'i aylık ücret değildir; hesaplarda tutulan rezervdir. Geçici deployment buffer bakiyesi loader tarafından deployment sırasında geri dönüştürülür/iade edilir; kesintide admin recovery/close akışı vardır. Mevcut creator kasalarını destekleyen programı kapatmak rutin bir tasarruf işlemi değildir. [Solana deployment rehberi](https://solana.com/docs/programs/deploying).

## Eski coin ve proof migration

Önceden final olmuş %10 platform veya launcher paylı token'ların zincirdeki oranı değiştirilemez. `pastPlatformBps: [1000]`, geçerli eski TikTok escrow biçimini okumak ve yarım launch'ı orijinal paylaşımıyla kurtarmak içindir. Yeni launch yalnız %20/%80 kullanır; eski token sayfası kendi gerçek split'ini gösterir.

GitHub sürümündeki native pump.fun sosyal fee hesapları TikTok escrow'una dönüşmez. Yeni program/verifier public adresi yeni PDA üretir; eski coin'in ücret alıcısı değişmez. Eski program, verifier ve bağlı cüzdan erişimi korunmadan altyapı kapatılmaz.

Manual proof işlemleri; wallet, handle, nonce, video ID ve onay/iptal/aktivasyon makbuzlarını public blockchain'e yazar. Proof hesabının kapanması rent'i iade eder fakat işlem geçmişini silmez. Video silinirse TikTok'ta erişim değişebilir; zincir kayıtları kalır. [Privacy policy](src/app/privacy/page.tsx) bu kapsamı açıklar.

## Kontroller

```bash
npm run typecheck
npm test
npm run build
cargo test --manifest-path programs/tiktok-escrow/Cargo.toml
cargo build-sbf --manifest-path programs/tiktok-escrow/Cargo.toml
```

Yerel testler yalnız validator ve throwaway test cüzdanları kullanır; gerçek pump.fun programlarıyla native paylaşım, dağıtım, creator claim, rent koruması ve proof yetkilerini kontrol eder. Local testlerin geçmesi gerçek TikTok videosunun elle incelendiği, mainnet programın deploy edildiği veya bağımsız audit yapıldığı anlamına gelmez.
