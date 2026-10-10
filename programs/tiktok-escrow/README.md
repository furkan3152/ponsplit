# TikTok creator escrow

Bu program, pump.fun gelir paylaşımında TikTok kullanıcı adları için SOL kasaları oluşturur. Pump.fun'ın GitHub/X sosyal hesap programını kullanmaz. Her kasa bu programın hesabıdır; pump.fun gelir dağıtımı SOL'u doğrudan kasa PDA'sına aktarır.

## Hesap ve talimatlar

PDA seedleri: `['creator', verifier_public_key_bytes, normalized_handle_bytes]`. Kullanıcı adı küçük harfli ASCII, 1–24 bayt; harf, sayı, `_`, `.` içerebilir ve noktayla bitemez. Doğrulama otoritesinin seedlerde bulunması, başka birinin kasayı önce oluşturup otoriteyi değiştirmesini önler.

Hesap 138 bayttır:

| Offset | Alan |
| --- | --- |
| 0 | `TIKVAULT` (8 bayt) |
| 8 | PDA bump (`u8`) |
| 9 | Kullanıcı adı uzunluğu (`u8`) |
| 10 | Kullanıcı adı, sağa sıfır dolgulu (24 bayt) |
| 34 | Doğrulama otoritesi (`Pubkey`, 32 bayt) |
| 66 | Hak sahibi cüzdan (`Pubkey`, 32 bayt; doğrulanmamışsa sıfır) |
| 98 | TikTok kimlik hash'i (32 bayt; doğrulanmamışsa sıfır) |
| 130 | Toplam çekilen lamport (`u64`, little endian) |

- `0 + handle_length(u8) + handle + verifier(32)`: Hesaplar `payer(signer,writable), vault(writable), system`. Herkes oluşturabilir; tekrar oluşturma mevcut kimliği veya hak sahibini değiştirmez. Önceden SOL gönderilmiş sistem hesabı PDA'sı da güvenle oluşturulur.
- `1 + identity_hash(32)`: Hesaplar `verifier(signer), beneficiary(signer), vault(writable)`. Doğrulama otoritesi ve hak sahibi birlikte imzalar. Bağlama yalnızca bir kez yapılabilir; hash sıfır olamaz. Doğrulama otoritesi hak sahibi olarak bağlanamaz.
- `2`: Hesaplar `beneficiary(signer,writable), vault(writable)`. Kira rezervinin üzerindeki tüm SOL hak sahibine gider; toplam çekilen miktar güncellenir. Yetkisiz hesap, eksik imza, doğrulanmamış kasa ve taşma reddedilir. Doğrulama otoritesine özel para çekme yetkisi yoktur.

## Güven modeli

Doğrulama otoritesi, TikTok OAuth kimliğinin kullanıcı adına ait olduğunu onaylar. Zincir programı TikTok API'sini çağırmaz; otoritenin bu onayına güvenir. Backend yalnızca kullanıcının TikTok hesabı ve bağlanacak cüzdan imzası doğrulandıktan sonra bağlama talimatını imzalamalıdır. Kullanıcı adı ve hak sahibi kalıcıdır; TikTok kullanıcı adı değişikliği ya da geri dönüşümü mevcut kasayı yeniden bağlayamaz. Aynı otoriteyi yeni bir anahtara taşımak yeni PDA adresleri üretir ve mevcut coinlerin sabit gelir paylaşımını değiştirmez.

Kaynak kod build edilebilir; bu dizin ana ağ dağıtımı yapılmış gibi bir program adresi içermez. Üretimde `NEXT_PUBLIC_TIKSPLIT_ESCROW_PROGRAM_ID` gerçek dağıtılmış programı, `NEXT_PUBLIC_TIKSPLIT_VERIFIER` gerçek imzalayıcı otoritesini belirtmelidir. Program upgrade yetkisi ayrıca değerlendirilmelidir: kaynakta değişmez olan kurallar upgrade yapılabilen bir dağıtımda değiştirilebilir.

## Kontroller

```bash
cargo test --manifest-path programs/tiktok-escrow/Cargo.toml --locked
cargo build-sbf --manifest-path programs/tiktok-escrow/Cargo.toml -- --locked
node --experimental-strip-types --import ./src/lib/test-hooks.mjs --test src/lib/solana/tiktok-escrow.test.ts
```

Native Rust testleri doğrudan program işlemcisini, hesap imzalarını, otorite/owner/PDA kontrollerini, kalıcı bağlamayı, kira rezervini, para transferini ve taşmaları doğrular. TypeScript testleri talimat ABI'sini, doğrulanan hesap okumasını ve lamport hesaplarını doğrular. Gerçek validator smoke testi `e2e/solana/tiktok-local.mjs` içindedir.

Solana CLI 2.3.13 / platform-tools 1.48 (Rust 1.84.1) ile SBF build doğrulanır. `Cargo.lock` bu toolchain için uyumlu sürümleri sabitler; lock dosyası güncellenirken SBF build tekrar kontrol edilmelidir.
