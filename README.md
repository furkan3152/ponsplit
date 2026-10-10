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
| `NEXT_PUBLIC_SOLANA_LOCAL_RPC_URL` | Yalnız yerel validator testleri için loopback URL. Production’da boş bırakın. Browser `https://solana-rpc.publicnode.com`, server ve kısıtlı hesap taramaları resmi `https://api.mainnet-beta.solana.com` kullanır; eski `SOLANA_RPC_URL` / `NEXT_PUBLIC_SOLANA_RPC_URL` artık okunmaz. |
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

## Açılışta ilk alım ve tamamlanma sınırı

TikTok açılışında token alımı yapılmaz. Önce mint, creator kasası ve kalıcı %20/%80 paylaşımı tamamlanır; ardından coin sayfasındaki normal al/sat paneli canlı fiyatla ve ayrı cüzdan onayıyla kullanılır. Böylece uygulamanın ilk alımının creator ücreti geçici launcher hesabında kalmaz. İlk işlem fiyatı veya ilk alıcı olma garantisi yoktur.

Açılış birden fazla Solana işlemidir; atomik değildir. Mint ile paylaşımın kesinleşmesi arasındaki doğrudan dış piyasa işlemleri geçici launcher'a ücret üretebilir. Tamamlanmamış mint'ler Tiksplit listelerine alınmaz; tarayıcıdaki kayıt ile aynı cüzdandan tamamlanır. Tarayıcı verilerini temizlemek kayıtlı recovery bilgisini kaybettirebilir. Gerçek mainnet kabul testi tamamlanmadan genel kullanıma hazır olduğu iddia edilmez. Ayrıntılı kontrol: [yayın kontrol listesi](docs/launch-checklist.md).

## Maliyet — 10 Ekim 2026

**Canlı mainnet teklifi (10 Ekim 2026):** Resmi mainnet RPC üzerinden 63,552 byte ortak program için başlangıç bakiyesi `0.325586360 SOL`, final rent + fee `0.324931120 SOL` ölçüldü. Bunun `0.324556120 SOL` kısmı program rent'i, `0.000375000 SOL` kısmı 73 işlemin ücreti; başlangıç bakiyesinde ayrıca `0.000650240 SOL` cüzdan rent rezervi ve `0.000005 SOL` recovery payı var. Mainnet rent tarifesi aşağıdaki eski validator sürümünün yerel tarifesinden düşük. Bu bir teklif sorgusudur; mainnet'e program kurulmadı veya para gönderilmedi. Panel her kurulumda yeniden hesaplar. Bu ortak program tek sefer kurulur; coin oluşturma ve varsa ilk alım bütçesi ayrıca hesaplanır.


| Kalem | Tahmin / kaynak |
| --- | --- |
| Mainnet program deployment | 10 Ekim 2026 canlı mainnet RPC teklifi: `0.324931120 SOL` rent + fee, `0.325586360 SOL` başlangıç bakiyesi. **Güncel tutarı `/admin` yeniden hesaplar.** Bu bir fiyat sorgusudur; mainnet deployment yapılmadı. |
| Creator proof isteği | 143 byte için varsayılan yerel rent `0.00188616 SOL`; uygulama gerçek RPC tutarını gösterir. İptal/onayda rent geri döner; network ücretleri harcanır. |
| Vercel Pro | [$20/ay + kullanım aşımı](https://vercel.com/pricing). Hobby kişisel/ticari olmayan kullanım içindir. |
| RPC | PublicNode mainnet, API anahtarı ve aylık RPC ücreti yok. Paylaşılan servis yoğun trafikte limitlenebilir; kesintisiz erişim garantisi yok. |
| Redis | Bugünkü manual verification için gerekmez. İsteğe bağlı server admin otomasyonunda [Upstash Free kota veya $0.20/100 bin komut](https://upstash.com/pricing/redis); storage/bandwidth/replica kullanımını ayrıca değerlendirin. |
| Verifier imzalayıcı | Bugünkü manual approval admin cüzdanında imzalanır; ayrı signer aboneliği gerekmez. Gelecekte OAuth attestation seçilirse sağlayıcı maliyeti ayrıdır. |
| Storage, domain, audit | Kullanıma ve sağlayıcı/denetim kapsamına göre ayrı teklif. Mevcut storage/RPC kullanılabilir. |

Yerel deployment hesabı **73 işlem** içerir: 71 write, 1 buffer create ve 1 deploy. Final tutarın `0.444667440 SOL` kısmı program hesaplarında tutulan rent, `0.000375000 SOL` kısmı işlem ücreti tahminidir. Başlangıç bakiyesi final tutara cüzdanın rent-exempt kalması için `0.000890880 SOL` ve recovery için `0.000005 SOL` ekler. `0.443470320 SOL` yükleme buffer'ı loader tarafından ProgramData oluşturulmadan önce ödeyiciye aktarılır ve program rent'i için yeniden kullanılır; ikinci kez bütçeye eklenmez. Mainnet paneli güncel rent/fee değerleriyle yeniden fiyatlar.

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

### Mobil cüzdanda yarım kalan program kurulumu

Buffer oluşturma başarılı olup upload durursa, rent buffer hesabında kalır. Aynı buffer'dan **Resume the verified upload** ile devam edin; yeniden rent yatırılmaz. Tarayıcı kaydı kaybolduysa `/admin?buffer=<public-buffer-address>` bağlantısı veya **Recover an existing upload** alanı üzerinden **Check and restore buffer** seçin. Panel önce loader sahibini, admin yetkisini, boyutu ve mevcut byte'ları doğrular; bu kontrol işlem göndermez. OKX'te tek tek imzalama varsayılandır. Her yazma işlemi gönderilip onaylandıktan sonra yenisi imzalanır; diğer cüzdanlar en fazla dört işlemlik varsayılan gruplar kullanır. Son imzalı transaction ID gönderimden önce saklanır; bağlantı kesilirse zincirde confirmed/finalized olup olmadığı kontrol edilir. Belirsiz sonuçta yeniden ödeme yapmak yerine mevcut buffer ve işlem durumunu kontrol edin.
