# TikTok creator escrow

Bu program, pump.fun gelir paylaşımında TikTok kullanıcı adları için SOL kasaları oluşturur. Pump.fun'ın GitHub/X sosyal hesap programını kullanmaz. Her kasa bu programın hesabıdır; pump.fun gelir dağıtımı SOL'u doğrudan kasa PDA'sına aktarır.

## Hesap ve talimatlar

PDA seedleri: `['creator', verifier_public_key_bytes, normalized_handle_bytes]`. Kullanıcı adı küçük harfli ASCII, 1–24 bayt; harf, sayı, `_`, `.` içerebilir ve noktayla bitemez. Doğrulama otoritesinin seedlerde bulunması, başka birinin kasayı önce oluşturup otoriteyi değiştirmesini önler.

Hesap 138 bayttır:

| Offset | Alan |
| --- | --- |
| 0 | `TIKVAULT` veya aktivasyon bekleyen `TIKAPPRV` (8 bayt) |
| 8 | PDA bump (`u8`) |
| 9 | Kullanıcı adı uzunluğu (`u8`) |
| 10 | Kullanıcı adı, sağa sıfır dolgulu (24 bayt) |
| 34 | Doğrulama otoritesi (`Pubkey`, 32 bayt) |
| 66 | Hak sahibi cüzdan (`Pubkey`, 32 bayt; doğrulanmamışsa sıfır) |
| 98 | TikTok kimlik hash'i (32 bayt; doğrulanmamışsa sıfır) |
| 130 | Toplam çekilen lamport (`u64`, little endian) |

- `0 + handle_length(u8) + handle + verifier(32)`: Hesaplar `payer(signer,writable), vault(writable), system`. Herkes oluşturabilir; tekrar oluşturma mevcut kimliği veya hak sahibini değiştirmez. Önceden SOL gönderilmiş sistem hesabı PDA'sı da güvenle oluşturulur.
- `1 + identity_hash(32)`: Hesaplar `verifier, beneficiary(signer), vault(writable)`. Manuel onaylı `TIKAPPRV` kasasında sabit hak sahibi doğru hash ile yalnız başına imzalar; kasa `TIKVAULT` olur. Boş kasaya OAuth ile ilk bağlamada ayrıca `verifier` imzası gerekir. Bağlama yalnızca bir kez yapılabilir; hash sıfır olamaz. Doğrulama otoritesi hak sahibi olarak bağlanamaz.
- `2`: Hesaplar `beneficiary(signer,writable), vault(writable)`. Kira rezervinin üzerindeki tüm SOL hak sahibine gider; toplam çekilen miktar güncellenir. Yetkisiz hesap, eksik imza, doğrulanmamış veya aktivasyon bekleyen kasa ve taşma reddedilir. Doğrulama otoritesine özel para çekme yetkisi yoktur.

## Zincir üzerinde video doğrulama talebi

Manuel doğrulama TikTok uygulaması veya API erişimi gerektirmez. Hak sahibi önce kendi cüzdanıyla talep oluşturur. İmzalı talebin 16 bayt nonce değeri, kullanıcı adı ve tam cüzdan adresi video açıklamasındaki `TIK-<handle>-<tam_base58_cüzdan>-<nonce_hex>` kodunu oluşturur. Yalnız nonce içeren kod kabul edilmemelidir; herkese açık kod başka cüzdanın talebine kopyalanabilir. Yönetici gerçek kullanıcı adındaki gerçek videoyu ve tam kodu inceleyip talebin o an incelenen verisinin SHA256 hash'ini imzalar. Hak sahibi ayrıca kasayı etkinleştirir; bu adımdan önce kimse gelir çekemez.

Talep PDA seedleri `['proof', verifier_bytes, handle_bytes, beneficiary_bytes]`. Hesap 143 bayttır: `TIKPROOF` (8), bump (1), kullanıcı adı uzunluğu (1), kullanıcı adı sıfır dolgulu (24), verifier (32), beneficiary (32), nonce (16), oluşturulma zamanı `i64` little endian (8), video ID uzunluğu (1), video ID sıfır dolgulu (20). Video ID pozitif, başta sıfır bulunmayan 1–20 ASCII rakamdır. Talep 48 saat sonra zincir saatine göre geçersiz olur; iptal edilip kira geri alınabilir.

- `3 + handle_length(u8) + handle + nonce(16)`: Hesaplar `beneficiary(signer,writable), proof(writable), vault, verifier, system`. Boş ve daha önce oluşturulmuş kanonik kasa gerekir. Talebi yalnız hak sahibi kendi cüzdanıyla oluşturabilir. Aynı nonce ile tekrar çağrı süresi dolmamış talepte idempotenttir; mevcut farklı nonce üzerine yazılamaz.
- `4 + video_id_length(u8) + video_id`: Hesaplar `beneficiary(signer), proof(writable)`. Hak sahibi süresi dolmamış talebe video bağlar; nonce veya oluşturulma zamanı değişmez.
- `5 + expected_proof_sha256(32)`: Hesaplar `verifier(signer), proof(writable), vault(writable), beneficiary(writable)`. İncelenen 143 baytın hash'i işlem sırasında tekrar doğrulanır. Videonun değiştirilmesi veya talebin farklı verilerle yeniden oluşturulması eski yönetici imzasını geçersiz kılar. Kasa sabit hak sahibi ve hash ile `TIKAPPRV` durumuna gelir. Talep kapatılır ve tüm bakiyesi kayıtlı hak sahibine iade edilir; kasa bakiyesi değişmez.
- `6`: Hesaplar `beneficiary(signer,writable), proof(writable)`. Süresi geçmiş talepler dahil talebi yalnız hak sahibi kapatabilir; tüm bakiye kendi cüzdanına iade edilir. Yönetici iptal edemez veya iade hedefini değiştiremez.

## Güven modeli

Doğrulama otoritesi manuel modda gerçek videoyu ve cüzdanla bağlantılı tam kodu inceleyen yönetici cüzdanıdır. OAuth modunda ise TikTok kimliğinin kullanıcı adına ait olduğunu onaylayan otoritedir. Zincir programı TikTok API'sini çağırmaz ve videoyu okuyamaz; otoritenin dış dünyadaki bu incelemesine güvenir. Zincir kuralları ise önceki hak sahibi imzasını, incelenmiş talep hash'ini, sabit hak sahibini ve yalnız hak sahibinin gelir çekebilmesini zorunlu kılar. Kullanıcı adı ve hak sahibi kalıcıdır; TikTok kullanıcı adı değişikliği ya da geri dönüşümü mevcut kasayı yeniden bağlayamaz. Aynı otoriteyi yeni bir anahtara taşımak yeni PDA adresleri üretir ve mevcut coinlerin sabit gelir paylaşımını değiştirmez.

Kaynak kod build edilebilir; bu dizin ana ağ dağıtımı yapılmış gibi bir program adresi içermez. Üretimde `NEXT_PUBLIC_TIKSPLIT_ESCROW_PROGRAM_ID` gerçek dağıtılmış programı, `NEXT_PUBLIC_TIKSPLIT_VERIFIER` gerçek imzalayıcı otoritesini belirtmelidir. Program upgrade yetkisi ayrıca değerlendirilmelidir: kaynakta değişmez olan kurallar upgrade yapılabilen bir dağıtımda değiştirilebilir.

## Kontroller

```bash
cargo test --manifest-path programs/tiktok-escrow/Cargo.toml --locked
cargo build-sbf --manifest-path programs/tiktok-escrow/Cargo.toml -- --locked
node --experimental-strip-types --import ./src/lib/test-hooks.mjs --test src/lib/solana/tiktok-escrow.test.ts
```

Native Rust testleri doğrudan program işlemcisini, hesap imzalarını, otorite/owner/PDA kontrollerini, talep süresini, incelenmiş veri hash'ini, kalıcı bağlamayı, aktivasyon öncesi çekim engelini, kira rezervini, iadeyi, para transferini ve taşmaları doğrular. TypeScript testleri talimat ABI'sini, doğrulanan hesap okumasını ve lamport hesaplarını doğrular. Gerçek validator testleri `e2e/solana/tiktok-local.mjs` ve `e2e/solana/manual-proof-local.mjs` içindedir.

Solana CLI 2.3.13 / platform-tools 1.48 (Rust 1.84.1) ile SBF build doğrulanır. `Cargo.lock` bu toolchain için uyumlu sürümleri sabitler; lock dosyası güncellenirken SBF build tekrar kontrol edilmelidir.

## Düşük maliyetli build

Release build boyut optimizasyonu (`opt-level=s`, fat LTO, tek codegen unit) ve taşma kontrolleri kullanır. Sadece kullanılan System Program transfer/allocate/assign talimatları doğrudan sabit ABI ile kodlanır; native test resmi SDK ile byte ve hesap yetkilerini karşılaştırır. Genel amaçlı serializer kodu zincire yüklenmez. Kompakt panic handler işlemeyi abort eder; ayrıntılı biçimlendirilmiş panic çıktısı yerine sabit mesaj üretir. Normal doğrulama hata kodları, para akışı, hesap düzenleri ve imza kontrolleri korunur.

63,552 byte build için yerel minimum bütçe testi yalnız `0.445938320 SOL` cüzdan bakiyesiyle gerçek loader deployment/resume işlemini tamamlar. Final rent+fee `0.445042440 SOL`; kalan bakiye cüzdan rent rezervi ve recovery ücretidir. Loader buffer SOL'unu ProgramData oluşturmadan önce yeniden kullanır. Mainnet teklifi panelde RPC üzerinden hesaplanır.
