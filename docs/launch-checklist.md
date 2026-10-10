# Bugün yayına çıkış: TikTok video koduyla doğrulama

10 Ekim 2026. Yeni coin paylaşımı **%20 platform / %80 tek TikTok creator escrow'u**dur. Bugünkü doğrulama **orijinal TikTok videosuna admin'in elle bakmasıdır**. TikTok developer app, API, otomatik scraper veya harici signer kurulumu bugünkü akış için gerekli değildir.

## Deploy öncesi son kontrol — 10 Ekim 2026

72 web birim testi, production build ve 22 desktop/mobile sayfa kontrolü geçti. Ayrıca mainnet'teki pump.fun, PumpSwap ve fee programları doğrudan okunup 5 Ekim test snapshot'larının güncel sürümle farklı olduğu saptandı. Fixture programları ve ilgili hesaplar 10 Ekim mainnet verisiyle yenilendi; sıkıştırılmış `.so.gz` dosyaları programın padding dahil birebir byte'larını korur. Güncel programlarla yerel validator üzerinde açılış, ilk alımdaki %20/%80 ücret yönlendirmesi, kesintiden tamamlanma, yetkisiz claim reddi, creator claim ve PumpSwap'a geçiş/işlem/claim geçti. Bunlar mainnet üzerinde gerçek para ile yapılmış işlemler değildir.

UseReels'in [10 Ekim'de okunan dokümanındaki](https://www.usereels.app/docs) temel creator ücret biriktirme/doğrulama/çekme akışı uygulanır. Bu sürüm SOL cüzdan ödemesi ve manuel TikTok video doğrulaması kullanır; UseReels'in PayPal/banka/kart ödemeleri, Clips kampanyaları, $REELS yakımı ve Pons/ETH desteği bu kapsamda yoktur. Mevcut fonksiyonların test edilmesi bütün UseReels özelliklerinin tamamlandığı veya bağımsız audit yapıldığı anlamına gelmez.

Canlı program ID'si bağlanıp gerçek TikTok video kanıtı ve küçük tutarlı mainnet coin → alım → dağıtım → creator claim makbuzları doğrulanana kadar genel yayına hazır kabul etmeyin. Public runtime durumu bu kontrolde `launchesReady: false`, program adresi boştu; eksik kurulumda yeni coin açılışı kapalıdır.

## 1. Mevcut hosting'i hazırlayın

- [ ] Mevcut Vercel production RPC ve Blob/Pinata storage ayarlarını koruyun; erişimleri doğrulayın.
- [ ] `SITE_URL` için gerçek HTTPS public origin'i kullanın; path/query/hash eklemeyin. Browser RPC origin kısıtı bu domain'i kapsamalı.
- [ ] Admin ve varsayılan manual verifier public adresinin `D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm` olduğunu kontrol edin. Owner'ın private key/seed'ini environment'a veya uygulamaya girmeyin.
- [ ] Güncel kodu publish/rebuild edin. Public `/privacy` ve `/terms` sayfalarının erişilebilir olduğuna bakın.

Varsayılan `/admin` unlock, deployment, proof review/onay ve para işlemleri admin cüzdanı içinde imzalanır; Redis veya TikTok OAuth kurulumu bunların ön koşulu değildir.

## 2. Güncel programı bir kez mainnet'e deploy edin

- [ ] Admin cüzdanını `/admin` sayfasına bağlayıp wallet challenge'ını imzalayın.
- [ ] Güncel 63,552 byte manual-verification program artifact'ını ve mainnet RPC'nin SOL teklifini inceleyin. Aşağıdaki yerel RPC tahminini mainnet'in kesin fiyatı olarak kabul etmeyin.
- [ ] Cüzdanda teklif ekranındaki konservatif rezervi bulundurun; **Deploy** işlemini cüzdanınızda imzalayın.
- [ ] Kesintide kaydedilmiş public buffer adresiyle devam edin. Mevcut programın durumunu kontrol etmeden yeniden deploy etmeyin. Vazgeçilen buffer için admin recovery/close kullanılabilir.
- [ ] Son program ID ve transaction receipt'ini kaydedin; executable, artifact eşleşmesi ve admin upgrade authority kontrolleri geçmelidir.
- [ ] `NEXT_PUBLIC_TIKSPLIT_ESCROW_PROGRAM_ID` için gerçek program ID'sini Vercel'e girin. `NEXT_PUBLIC_TIKSPLIT_VERIFIER` default admin public adresini kullanır. Public environment değişikliği sonrası production rebuild yapın.

Program hesaplarındaki rent rezervi aylık ücret değildir. Geçici buffer deployment sırasında geri dönüştürülür/iade edilir. Kaynak/artifact hash kontrolü bağımsız audit yerine geçmez; program upgrade edilebiliyorsa admin authority güven modeli içindedir.

Admin upgrade yetkisi korunur; panelde feragat/renounce işlemi yoktur. Rent iadesi iki farklı işlemdir:
- Yarım kalan upload buffer'ı kapatılıp tüm mevcut bakiyesi, işlem ücreti düşüldükten sonra admin'e geri alınabilir.
- **Hiç kullanılmamış ve hiçbir siteye bağlanmamış** güncel doğrulanmış deployment, panelde “Recover rent from an unused program” ile incelenebilir. Program ID tekrar yazılıp ayrı wallet işlemiyle kalıcı kapatma onaylanır. ProgramData bakiyesi admin'e döner; küçük program-adresi hesabının rent'i ve network ücretleri dönmez. Program artık çalışmaz. Bu, çalışan programdan rent çekme özelliği değildir.

Panel hem tarayıcı hem güncel sunucu yapılandırmasındaki programı korur; programın sahip olduğu herhangi bir account (bakiyesi yalnız rent olan boş creator kasası dahil) kapatmayı engeller. Kontroller wallet imzasından sonra tekrar yapılır. Bunlar RPC üzerinden yapılan panel kontrolleridir, atomik bir zincir üstü shutdown kilidi değildir: kapatılan deployment başka bir siteye bağlı olmamalı ve aynı sırada kullanılmamalıdır. Mevcut veya gelecekteki creator ücretleri bağlanmış bir program kapatılmaz. Owner upgrade yetkisi ayrıca bir güven varsayımıdır; yetkili cüzdanın panel dışındaki loader işlemlerini bu UI engelleyemez.


## 3. Gerçek TikTok hesabıyla proof isteği

- [ ] Creator'ın kontrol ettiği, erişimini kaybetmeyeceği cüzdanı bağlayın ve `/claim` sayfasında kendi güncel TikTok handle'ını seçin.
- [ ] **Request verification** işlemini cüzdanda imzalayın. Zincirde wallet + handle + 128 bit nonce kaydı açılır. Proof hesabı 143 byte'tır; gösterilen rent mainnet RPC'den hesaplanır (varsayılan yerel hesap `0.00188616 SOL`).
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

Server'ın Vercel environment'ını otomatik değiştirmesi/rebuild başlatması istenirse ayrıca `ADMIN_SESSION_SECRET` (en az 32 byte), güvenilen `SITE_URL`, production Redis REST URL/token ve server-only `VERCEL_DEPLOY_TOKEN` yapılandırılır. Bu yol olmadan public program ID'si Vercel'e elle girilebilir; default on-chain review için Redis zorunlu değildir.

TikTok OAuth daha sonra opsiyonel olarak açılabilir: gerçek approved Login Kit app, `user.info.basic` + `user.info.profile`, aynı public origin'deki `/api/tiktok/callback`, client key/secret, session secret ve uygun attestation signer gerekir. Onay garantisi yoktur. Resmi [Web Login Kit](https://developers.tiktok.com/doc/login-kit-web), [scopes](https://developers.tiktok.com/doc/tiktok-api-scopes/) ve [review](https://developers.tiktok.com/doc/app-review-guidelines/) belgeleri geçerlidir. Verifier/program adresi değişikliği yeni PDA üretir; mevcut manual kasaların claim yolunu korumadan geçiş yapılmaz.

## 7. Geçmiş coin'ler ve bütçe

**Canlı mainnet teklifi (10 Ekim 2026):** Resmi mainnet RPC üzerinden 63,552 byte ortak program için başlangıç bakiyesi `0.325586360 SOL`, final rent + fee `0.324931120 SOL` ölçüldü. Bunun `0.324556120 SOL` kısmı program rent'i, `0.000375000 SOL` kısmı 73 işlemin ücreti; başlangıç bakiyesinde ayrıca `0.000650240 SOL` cüzdan rent rezervi ve `0.000005 SOL` recovery payı var. Mainnet rent tarifesi aşağıdaki eski validator sürümünün yerel tarifesinden düşük. Bu bir teklif sorgusudur; mainnet'e program kurulmadı veya para gönderilmedi. Panel her kurulumda yeniden hesaplar. Bu ortak program tek sefer kurulur; coin oluşturma ve varsa ilk alım bütçesi ayrıca hesaplanır.


Final olmuş eski %10 platform veya launcher paylı coin'ler kendi orijinal split'ini korur. `pastPlatformBps: [1000]` bunları okumak içindir; yeni coin'ler %20/%80 kullanır. Eski GitHub pump.fun sosyal hesapları TikTok escrow'una dönüşmez. Program/verifier değişikliği eski coin'in alıcı adresini taşımaz.

| Kalem | 10 Ekim 2026 başlangıç bilgisi |
| --- | --- |
| Program | 10 Ekim 2026 canlı mainnet RPC teklifi: `0.324931120 SOL` rent + fee, `0.325586360 SOL` başlangıç bakiyesi. **Güncel tutarı `/admin` yeniden hesaplar.** Bu bir fiyat sorgusudur; mainnet deployment yapılmadı. |
| Proof hesabı | 143 byte; yerel varsayılan rent `0.00188616 SOL`, canlı tutar panelde. Rent iptal/onayda geri döner; işlem ücretleri dönmez. |
| Vercel Pro | [$20/ay + kullanım aşımı](https://vercel.com/pricing). |
| RPC | Mevcut RPC veya isteğe bağlı [Helius Developer $49/ay](https://www.helius.dev/pricing). |
| Redis/signer | Bugünkü manual proof için ek hizmet zorunlu değil. Opsiyonel server Redis için [Free kota / $0.20 per 100 bin komut](https://upstash.com/pricing/redis); gelecekteki OAuth signer maliyeti sağlayıcıya bağlı. |
| Storage, domain, audit | Mevcut hizmet/kullanım ve kapsamına göre ayrı maliyet. |

Yerel deployment tahmini 73 işlemden oluşur: 71 write + 1 buffer create + 1 deploy. Final tutar `0.444667440 SOL` program rent'i + `0.000375000 SOL` işlem ücreti içerir. Başlangıç bakiyesi ayrıca `0.000890880 SOL` cüzdan rent rezervi ve `0.000005 SOL` recovery ücreti içerir. `0.443470320 SOL` buffer bakiyesi deployment sırasında ProgramData hesabı oluşturulmadan önce yeniden kullanılır; ikinci kez gerekli bakiyeye eklenmez. İptalde buffer rent'i geri alınır; işlem ücretleri harcanır.

Sabit aylık Vercel/RPC tabanı $20 veya Helius seçilirse $69; tüm projenin toplam maliyeti değildir. SOL dolar karşılığı sabitlenmez.
