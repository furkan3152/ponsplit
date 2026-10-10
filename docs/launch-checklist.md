# Bugün yayına çıkış: TikTok video koduyla doğrulama

10 Ekim 2026. Yeni coin paylaşımı **%20 platform / %80 tek TikTok creator escrow'u**dur. Bugünkü doğrulama **orijinal TikTok videosuna admin'in elle bakmasıdır**. TikTok developer app, API, otomatik scraper veya harici signer kurulumu bugünkü akış için gerekli değildir.

## Mainnet kurulum doğrulaması — 10 Ekim 2026

Program [`2ns8wbrKD54m5ExMtyKhZiqHkjTe7aNb1Y2jRmapp7ri`](https://solscan.io/account/2ns8wbrKD54m5ExMtyKhZiqHkjTe7aNb1Y2jRmapp7ri) mainnet'e kuruldu. [İşlem](https://solscan.io/tx/4pUAo16ARurUCBG6aY1cduj6Ns7dA3dvgtnMAt6EUbHNZ8QoWAsDgvPXeyhtG1GPvmgCboPbeYw8eS4qZ9ivZE26) finalized. ProgramData `CMxWR9hAgmQJV911Hoyfzy9gvjgbmdTEuCDEBbKbne81`, 63,552 byte program hash'i `ea990737e64d98db25d53dd3d00547a03fd8a805071e0b8e0b7a56f5bd865ea4` ve admin upgrade authority birebir doğrulandı. Buffer kapandı; parası program rent'ine dönüştü. **Yeniden deploy veya program rent ödemesi gerekmiyor.**

Aynı yayınlanmış artifact ve 10 Ekim mainnet pump.fun/PumpSwap program snapshot'larıyla yerel testlerde açılış, %20/%80 paylaşım, kesintiden tamamlanma, video proof, admin review, creator aktivasyonu, yetkisiz claim reddi, rent koruması ve PumpSwap'a geçiş/işlem/claim geçti. Bunlar mainnet'te gerçek TikTok videosu ve creator claim denendiği anlamına gelmez.

UseReels'in [10 Ekim'de okunan dokümanındaki](https://www.usereels.app/docs) temel creator ücret biriktirme/doğrulama/çekme akışı uygulanır. Bu sürüm SOL cüzdan ödemesi ve manuel TikTok video doğrulaması kullanır; UseReels'in PayPal/banka/kart ödemeleri, Clips kampanyaları, $REELS yakımı ve Pons/ETH desteği bu kapsamda yoktur. Mevcut fonksiyonların test edilmesi bütün UseReels özelliklerinin tamamlandığı veya bağımsız audit yapıldığı anlamına gelmez.

Canlı program ID'si bağlanıp gerçek TikTok video kanıtı ve küçük tutarlı mainnet coin → alım → dağıtım → creator claim makbuzları doğrulanana kadar genel yayına hazır kabul etmeyin. Yayın sonrası `/api/runtime-status` içinde `launchesReady: true`, `artifactMatches: true` ve yukarıdaki program adresini kontrol edin. Eksik veya doğrulanamayan kurulumda yeni coin açılışı kapalı kalır.

## Telefonda uçtan uca küçük tutarlı test

İki kontrol ettiğiniz cüzdan kullanın: **A = mevcut D2Ts…Wtvm admin**, **B = TikTok sahibi creator cüzdanı**. B'yi kaybetmeyin: ilk aktivasyon kalıcıdır. Kendi TikTok hesabınızı kullanın.

1. B ile `/create` üzerinden kendi TikTok kullanıcı adınıza bir test coin açın. Açılışta alım yapılmaz. Platform launch ücreti `0.01 SOL`; panel yaklaşık `0.04 SOL` rent/ağ payı ayırır. Bu pay tahmindir, tamamı harcanmış kabul edilmez. Cüzdanın gerçek işlem tutarını inceleyin.
2. Coin sayfasında paylaşımın **20% platform / 80% creator** olduğunu görün. Sonra ayrı onayla küçük bir alım, örneğin `0.01 SOL`, yapın. Fiyat/slippage nedeniyle alım tutarı garanti değildir; satışı da ayrıca küçük tutarla deneyebilirsiniz.
3. A ile `/admin` → **Platform fees** bölümünden dağıtımı çalıştırın. %20 A'ya, %80 creator escrow'una gitmeli. B henüz doğrulanmadığı için biriken payı çekememeli. Paylaşım işlem hacminden değil, pump.fun'ın creator ücretinden hesaplanır.
4. B ile `/claim` → kendi TikTok handle'ınız → **Create my verification code**. Tam kodu kendi hesabınızdan public videoda/caption'da yayınlayın. Orijinal video bağlantısını girip **Submit video for admin review** işlemini imzalayın.
5. A ile `/admin` → video incelemesi: profil, handle ve tam kodu kontrol edip onaylayın. B'nin claim'i aktivasyona kadar kapalı kalmalı. Onaylanan proof hesabının rent'i B'ye döner.
6. B ile `/claim` → **Activate approved wallet**, ardından **Claim**. Creator kasasında yalnız rent tabanı kalmalı; B'nin artışı çekilen pay eksi ağ ücreti olmalı. A creator payını çekememeli.
7. Yeni küçük alım/satım sonrası dağıtım ve B claim'ini tekrarlayın. Her adımın Solscan linkini saklayın; işlem tekrarlandı diye aynı ücret ikinci kez ödenmemeli.

İlk test için B'de yaklaşık **0.07–0.08 SOL** çalışma bakiyesi, A'da işlem ücretlerini karşılayacak bakiye bırakmak panelin mevcut yaklaşık rezervleriyle uyumludur. Bu harcanacak sabit ücret değildir: alım/satım fiyat etkisi, rent ve güncel ağ ücretleri ayrıdır. Büyük işlem hacmi oluşturmaya gerek yoktur. Dağıtımda lamport yuvarlaması ve işlem ücretlerini ayrı tutun; wallet bakiyelerindeki farkları doğrudan 20/80 diye karşılaştırmayın.

Yerel gerçek program testi örneği: B'deki `0.07 SOL` ile açılış, `0.01 SOL` alım ve bütün manuel proof/claim akışı tamamlandı. Pump creator ücreti `29,630 lamport` oldu; bunun `5,926` lamport'u platforma, `23,704` lamport'u creator'a dağıtıldı. Bu örnek canlı fiyat garantisi değildir; küçük testte ağ ücretleri kazanılan creator ücretinden yüksek olabilir.

## 1. Mevcut hosting'i hazırlayın

- [ ] Mevcut Blob/Pinata storage ayarlarını koruyun; erişimleri doğrulayın. Browser PublicNode, server resmi Solana public mainnet RPC kullanır. İndeksli hesap sorguları yalnız uygulamanın izin verdiği read-only `/api/solana/accounts` yolundan geçer. Eski `SOLANA_RPC_URL` / `NEXT_PUBLIC_SOLANA_RPC_URL` değerleri okunmaz; Vercel’den kaldırılabilir.
- [ ] Vercel'de `tiksplit.com` domain'ini `ponsplit` projesinin production ortamına bağlayın; `tiksplit.com` için `www.tiksplit.com` adresine yönlendirme kullanın. Domain satın almak tek başına deployment'a bağlamaz. HTTPS ve `/admin` erişimini doğrulayın.
- [ ] Production `SITE_URL=https://www.tiksplit.com` olarak ayarlayıp rebuild edin; path/query/hash eklemeyin. Public RPC için domain izin listesi/API anahtarı gerekmez. Yeni domainin tarayıcısından `getGenesisHash` ve rent sorgusunu doğrulayın; HTTP 200 sayfa yanıtı RPC erişimini kanıtlamaz. Eski domain yönlendirmesini yeni domainin HTTPS erişimi doğrulandıktan sonra açın. Mevcut Solana program/verifier adresleri domain değişikliğiyle değişmez.
- [ ] Admin ve varsayılan manual verifier public adresinin `D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm` olduğunu kontrol edin. Owner'ın private key/seed'ini environment'a veya uygulamaya girmeyin.
- [ ] Güncel kodu publish/rebuild edin. Public `/privacy` ve `/terms` sayfalarının erişilebilir olduğuna bakın.

Varsayılan `/admin` unlock, deployment, proof review/onay ve para işlemleri admin cüzdanı içinde imzalanır; Redis veya TikTok OAuth kurulumu bunların ön koşulu değildir.

## 2. Kurulu programı kullanın (tamamlandı)

- [x] Mainnet programı executable, artifact birebir eşleşiyor, upgrade authority admin cüzdanında.
- [x] Public adres `src/tiktok-deployment.json` ile production varsayılanına kaydedildi. `NEXT_PUBLIC_TIKSPLIT_ESCROW_PROGRAM_ID` ayrıca zorunlu değildir; varsa override aynı adrese işaret etmelidir.
- [ ] `/admin` sayfasında cüzdan challenge'ını imzalayın; program doğrulaması ve video verification hazır durumunu görün.
- [ ] Aynı programı kullanın. Yeni deployment başlatmayın.

Program hesaplarındaki rent rezervi aylık ücret değildir. Geçici buffer deployment sırasında geri dönüştürülür/iade edilir. Kaynak/artifact hash kontrolü bağımsız audit yerine geçmez; program upgrade edilebiliyorsa admin authority güven modeli içindedir.

Admin upgrade yetkisi korunur; panelde feragat/renounce işlemi yoktur. Rent iadesi iki farklı işlemdir:
- Yarım kalan upload buffer'ı kapatılıp tüm mevcut bakiyesi, işlem ücreti düşüldükten sonra admin'e geri alınabilir.
- **Hiç kullanılmamış ve hiçbir siteye bağlanmamış** güncel doğrulanmış deployment, panelde “Recover rent from an unused program” ile incelenebilir. Program ID tekrar yazılıp ayrı wallet işlemiyle kalıcı kapatma onaylanır. ProgramData bakiyesi admin'e döner; küçük program-adresi hesabının rent'i ve network ücretleri dönmez. Program artık çalışmaz. Bu, çalışan programdan rent çekme özelliği değildir.

Panel hem tarayıcı hem güncel sunucu yapılandırmasındaki programı korur; programın sahip olduğu herhangi bir account (bakiyesi yalnız rent olan boş creator kasası dahil) kapatmayı engeller. Kontroller wallet imzasından sonra tekrar yapılır. Bunlar RPC üzerinden yapılan panel kontrolleridir, atomik bir zincir üstü shutdown kilidi değildir: kapatılan deployment başka bir siteye bağlı olmamalı ve aynı sırada kullanılmamalıdır. Mevcut veya gelecekteki creator ücretleri bağlanmış bir program kapatılmaz. Owner upgrade yetkisi ayrıca bir güven varsayımıdır; yetkili cüzdanın panel dışındaki loader işlemlerini bu UI engelleyemez.


## 3. Gerçek TikTok hesabıyla proof isteği

- [ ] Creator'ın kontrol ettiği, erişimini kaybetmeyeceği cüzdanı bağlayın ve `/claim` sayfasında kendi güncel TikTok handle'ını seçin.
- [ ] **Create my verification code** işlemini cüzdanda imzalayın. Zincirde wallet + handle + 128 bit nonce kaydı açılır. Proof hesabı 143 byte'tır; gösterilen rent mainnet RPC'den hesaplanır (varsayılan yerel hesap `0.00188616 SOL`).
- [ ] Uygulamadaki **kullanıcı adı + tam beneficiary cüzdan adresi + nonce'a bağlı bütün kanıt kodunu** kısaltmadan kendi TikTok hesabınızdan yayınladığınız public videonun caption'ına veya videoda görünür biçimde ekleyin. Yalnız nonce yayınlamak yeterli değildir.
- [ ] İlgili orijinal `https://www.tiktok.com/@aynı.handle/video/<id>` URL'sini uygulamaya ekleyip cüzdanınızla imzalayın. İstekteki handle ve video handle'ı aynı olmalıdır. Ekran görüntüsü/başka profil yeterli değildir.
- [ ] İstek 48 saat içinde incelenmezse yeni proof sürecini başlatmadan önce mevcut isteğin durumunu kontrol edin. İstek sahibi iptal edip rent'i geri alabilir; network ücretleri iade edilmez.

Kod kullanıcı adı, tam cüzdan adresi ve rastgele nonce'a bağlıdır; herkesin görebildiği bir blockchain/TikTok kanıtıdır. Kod private key veya OAuth token değildir. Video yayınlamanız ve isteğinizi iletmeniz otomatik onay anlamına gelmez.

## 4. Admin orijinal videoyu elle incelesin

- [ ] Admin panelinde istek sahibinin wallet, handle ve tam kodunu kontrol edin.
- [ ] Kullanıcının ekran görüntüsü üzerinden karar vermeyin. Orijinal TikTok video URL'sini ve yayınlayan profilini açın.
- [ ] Yayınlayan gerçek handle'ın istekle aynı olduğunu ve tam beneficiary cüzdan adresiyle nonce'ı içeren bütün kodun caption'da/visible video'da bulunduğunu kontrol edin. Kodun kısaltılmış halini kabul etmeyin. Profil/video erişilemiyorsa veya eşleşme belirsizse onay vermeyin.
- [ ] Uygun kanıtı admin cüzdanıyla zincirde onaylayın. Onay proof hesabını kapatıp rent rezervini istek sahibine iade eder.

Bu karar manual admin attestation'dır. Admin yanlış sahiplik kanıtını kabul ederse yanlış wallet'a onay verebilir; kaynak bağımsız denetimden geçmiş veya hatasız gibi sunulmaz. Admin'in creator escrow'undan para çekme yetkisi yoktur.

## Açılış ve ilk alım kontrolü

- [ ] Mint işlemi token alımı içermemeli. Uygulama ilk alımı coin sayfasında, paylaşım tamamlandıktan sonra ayrı wallet onayına bırakır.
- [ ] Mint sonrası kesintide coin henüz listelenmemeli; kayıtlı launch aynı wallet ile tamamlanabilmeli. Bu akış atomik değildir: aradaki dış pump.fun işlemleri henüz kilitlenmemiş geçici launcher'a creator ücreti oluşturabilir.
- [ ] Paylaşım tamamlandıktan sonraki **ilk alımın** creator ücreti de %20/%80 dağıtıma dahil olmalı; yalnız sonraki işlemleri kontrol etmek yeterli değildir.

## 5. Creator aktive edip küçük tutarlı claim'i test etsin

- [ ] Onaylanan istek sahibi cüzdanıyla aktivasyon/bağlama işlemini imzalayın. **İlk başarılı bağlama kalıcıdır.** Yalnız bu cüzdan creator payını çeker.
- [ ] Küçük tutarlı gerçek mainnet test coin'inde %20 platform / %80 creator native split'ini explorer'dan kontrol edin.
- [ ] Küçük bir işlemle oluşan creator ücretlerini distribute edin. %20'nin platform hazinesine, %80'in doğru creator escrow'una ulaştığını kontrol edin.
- [ ] Creator cüzdanıyla claim yapın; receipt, bakiyeler, total claimed ve escrow rent rezervini kontrol edin. Admin veya başka wallet creator payını claim edememelidir.
- [ ] İptal, expiry ve approval kapanışında proof rent iadesini; proof account kapanmasına rağmen public transaction history'nin kaldığını doğrulayın.
- [ ] Sonuçları tarih, mint/program ID ve public makbuzlarla kaydedin. Özel anahtar veya hassas service token'ı kaydetmeyin.

Gerçek video → manual review → owner aktivasyonu → mainnet dağıtım/claim testi yapılmadan canlı akışın doğrulandığı söylenmez. Yerel test, gerçek mainnet test ve bağımsız audit farklı kontrollerdir.

## 6. İsteğe bağlı server otomasyonu ve sonraki OAuth

Server'ın Vercel environment'ını otomatik değiştirmesi/rebuild başlatması istenirse ayrıca `ADMIN_SESSION_SECRET` (en az 32 byte), güvenilen `SITE_URL`, production Redis REST URL/token ve server-only `VERCEL_DEPLOY_TOKEN` yapılandırılır. Mevcut public program ID'si repoda kayıtlıdır; ayrıca token/Redis kurulumu gerekmez. İleride bu yol olmadan public konfigürasyon repo veya Vercel üzerinden güncellenebilir; default on-chain review için Redis zorunlu değildir.

TikTok OAuth daha sonra opsiyonel olarak açılabilir: gerçek approved Login Kit app, `user.info.basic` + `user.info.profile`, aynı public origin'deki `/api/tiktok/callback`, client key/secret, session secret ve uygun attestation signer gerekir. Onay garantisi yoktur. Resmi [Web Login Kit](https://developers.tiktok.com/doc/login-kit-web), [scopes](https://developers.tiktok.com/doc/tiktok-api-scopes/) ve [review](https://developers.tiktok.com/doc/app-review-guidelines/) belgeleri geçerlidir. Verifier/program adresi değişikliği yeni PDA üretir; mevcut manual kasaların claim yolunu korumadan geçiş yapılmaz.

## 7. Geçmiş coin'ler ve bütçe

**Mevcut program kuruldu:** Program hesabında `0.000833120 SOL`, ProgramData hesabında `0.323723000 SOL`, toplam `0.324556120 SOL` rent tutuluyor. Eski buffer kapandı. Kurulum ücreti tekrar ödenmez; creator proof, yeni coin ve alım/satımın ağ/rent maliyetleri ayrıdır.


Final olmuş eski %10 platform veya launcher paylı coin'ler kendi orijinal split'ini korur. `pastPlatformBps: [1000]` bunları okumak içindir; yeni coin'ler %20/%80 kullanır. Eski GitHub pump.fun sosyal hesapları TikTok escrow'una dönüşmez. Program/verifier değişikliği eski coin'in alıcı adresini taşımaz.

| Kalem | 10 Ekim 2026 başlangıç bilgisi |
| --- | --- |
| Program | Kuruldu. Mevcut hesaplarda toplam `0.324556120 SOL` rent; yeniden deploy gerekmez. |
| Proof hesabı | 143 byte; yerel varsayılan rent `0.00188616 SOL`, canlı tutar panelde. Rent iptal/onayda geri döner; işlem ücretleri dönmez. |
| Vercel Pro | [$20/ay + kullanım aşımı](https://vercel.com/pricing). |
| RPC | PublicNode + resmi Solana public RPC; mevcut kurulumda aylık RPC aboneliği yok. Paylaşılan servis limitleri geçerlidir. |
| Redis/signer | Bugünkü manual proof için ek hizmet zorunlu değil. Opsiyonel server Redis için [Free kota / $0.20 per 100 bin komut](https://upstash.com/pricing/redis); gelecekteki OAuth signer maliyeti sağlayıcıya bağlı. |
| Storage, domain, audit | Mevcut hizmet/kullanım ve kapsamına göre ayrı maliyet. |

Yerel deployment tahmini 73 işlemden oluşur: 71 write + 1 buffer create + 1 deploy. Final tutar `0.444667440 SOL` program rent'i + `0.000376775 SOL` işlem ücreti içerir. Başlangıç bakiyesi ayrıca `0.000890880 SOL` cüzdan rent rezervi, `0.000005 SOL` recovery ücreti ve azami cüzdan öncelik ücretleri için `0.000370000 SOL` pay içerir. `0.443470320 SOL` buffer bakiyesi deployment sırasında ProgramData hesabı oluşturulmadan önce yeniden kullanılır; ikinci kez gerekli bakiyeye eklenmez. İptalde buffer rent'i geri alınır; işlem ücretleri harcanır.

Sabit aylık Vercel/RPC tabanı $20 veya Helius seçilirse $69; tüm projenin toplam maliyeti değildir. SOL dolar karşılığı sabitlenmez.
