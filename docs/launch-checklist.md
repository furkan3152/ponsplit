# Bugün yayına çıkış: TikTok video koduyla doğrulama

10 Ekim 2026. Yeni coin paylaşımı **%20 platform / %80 tek TikTok creator escrow'u**dur. Bugünkü doğrulama **orijinal TikTok videosuna admin'in elle bakmasıdır**. TikTok developer app, API, otomatik scraper veya harici signer kurulumu bugünkü akış için gerekli değildir.

## 1. Mevcut hosting'i hazırlayın

- [ ] Mevcut Vercel production RPC ve Blob/Pinata storage ayarlarını koruyun; erişimleri doğrulayın.
- [ ] `SITE_URL` için gerçek HTTPS public origin'i kullanın; path/query/hash eklemeyin. Browser RPC origin kısıtı bu domain'i kapsamalı.
- [ ] Admin ve varsayılan manual verifier public adresinin `D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm` olduğunu kontrol edin. Owner'ın private key/seed'ini environment'a veya uygulamaya girmeyin.
- [ ] Güncel kodu publish/rebuild edin. Public `/privacy` ve `/terms` sayfalarının erişilebilir olduğuna bakın.

Varsayılan `/admin` unlock, deployment, proof review/onay ve para işlemleri admin cüzdanı içinde imzalanır; Redis veya TikTok OAuth kurulumu bunların ön koşulu değildir.

## 2. Güncel programı bir kez mainnet'e deploy edin

- [ ] Admin cüzdanını `/admin` sayfasına bağlayıp wallet challenge'ını imzalayın.
- [ ] Güncel 104,568 byte manual-verification program artifact'ını ve mainnet RPC'nin SOL teklifini inceleyin. Aşağıdaki yerel RPC tahminini mainnet'in kesin fiyatı olarak kabul etmeyin.
- [ ] Cüzdanda teklif ekranındaki konservatif rezervi bulundurun; **Deploy** işlemini cüzdanınızda imzalayın.
- [ ] Kesintide kaydedilmiş public buffer adresiyle devam edin. Mevcut programın durumunu kontrol etmeden yeniden deploy etmeyin. Vazgeçilen buffer için admin recovery/close kullanılabilir.
- [ ] Son program ID ve transaction receipt'ini kaydedin; executable, artifact eşleşmesi ve admin upgrade authority kontrolleri geçmelidir.
- [ ] `NEXT_PUBLIC_TIKSPLIT_ESCROW_PROGRAM_ID` için gerçek program ID'sini Vercel'e girin. `NEXT_PUBLIC_TIKSPLIT_VERIFIER` default admin public adresini kullanır. Public environment değişikliği sonrası production rebuild yapın.

Program hesaplarındaki rent rezervi aylık ücret değildir. Geçici buffer deployment sırasında geri dönüştürülür/iade edilir. Kaynak/artifact hash kontrolü bağımsız audit yerine geçmez; program upgrade edilebiliyorsa admin authority güven modeli içindedir.

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

Final olmuş eski %10 platform veya launcher paylı coin'ler kendi orijinal split'ini korur. `pastPlatformBps: [1000]` bunları okumak içindir; yeni coin'ler %20/%80 kullanır. Eski GitHub pump.fun sosyal hesapları TikTok escrow'una dönüşmez. Program/verifier değişikliği eski coin'in alıcı adresini taşımaz.

| Kalem | 10 Ekim 2026 başlangıç bilgisi |
| --- | --- |
| Program | Güncel 104,568 byte build için yerel RPC tahmini: `0.730743800 SOL` final rent + fee, `1.459690480 SOL` konservatif başlangıç rezervi. Canlı mainnet tutarı `/admin` panelinde yeniden hesaplanır; bu ölçüm canlı deployment sonucu değildir. |
| Proof hesabı | 143 byte; yerel varsayılan rent `0.00188616 SOL`, canlı tutar panelde. Rent iptal/onayda geri döner; işlem ücretleri dönmez. |
| Vercel Pro | [$20/ay + kullanım aşımı](https://vercel.com/pricing). |
| RPC | Mevcut RPC veya isteğe bağlı [Helius Developer $49/ay](https://www.helius.dev/pricing). |
| Redis/signer | Bugünkü manual proof için ek hizmet zorunlu değil. Opsiyonel server Redis için [Free kota / $0.20 per 100 bin komut](https://upstash.com/pricing/redis); gelecekteki OAuth signer maliyeti sağlayıcıya bağlı. |
| Storage, domain, audit | Mevcut hizmet/kullanım ve kapsamına göre ayrı maliyet. |

Yerel deployment tahmini 119 işlemden oluşur: 117 write + 1 buffer create + 1 deploy. Final tutar `0.730138800 SOL` program rent'i + `0.000605000 SOL` işlem ücreti içerir. Konservatif rezerv ayrıca `0.728941680 SOL` geçici buffer rent'i ve `0.000005 SOL` recovery ücreti içerir. Buffer rent'i deployment/close sırasında geri döner; işlem ücretleri harcanır.

Sabit aylık Vercel/RPC tabanı $20 veya Helius seçilirse $69; tüm projenin toplam maliyeti değildir. SOL dolar karşılığı sabitlenmez.
