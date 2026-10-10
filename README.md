# Tiksplit

TikTok kullanıcıları adına **Solana mainnet / pump.fun** token başlatan ve creator ücretlerini hesap sahibi için biriktiren uygulama. Next.js 14, pump.fun'ın resmi SDK'ları ve ayrı bir Solana escrow programı kullanır. UseReels'in ücret tahsis mantığından yararlanır; arayüzü özgündür. TikTok ve pump.fun ile resmi ortaklığı yoktur.

## Akış

1. `/create`: TikTok kullanıcı adı, token bilgileri, isteğe bağlı ilk alım ve %0–10 launcher payı seçilir. pump.fun `create_v2` token oluşturur; ardından kalıcı fee sharing kilitlenir. Yarım kalan basım cüzdan/mint bazında kaydedilir ve aynı paylaşım ile tamamlanır.
2. Creator ücretinin %10'u mevcut hazineye, %90 eksi launcher payı kullanıcı adına ayrılan escrow PDA'sına gider. Launcher payı varsa token'ı başlatan cüzdana gider. Bu oranlar işlem tutarının tamamına uygulanmaz. Platform token veya burn kesintisi yoktur.
3. `/token/[mint]`: gerçek bonding curve / PumpSwap fiyatı, alım satım ve permissionless ücret dağıtımı. Dağıtılan SOL, kullanıcı henüz doğrulanmamışken de escrow'da birikir.
4. `/claim` ve `/creator/[handle]`: escrow bakiyesi, dağıtılmamış ücretler ve gerçek toplam çekim görülür. TikTok Login Kit hesabın güncel kullanıcı adını ve `open_id` bilgisini doğrular. Kullanıcı hem cüzdan mesajını hem bağlama işlemini imzalar. Harici doğrulama hizmeti aynı işlemi doğrulayıcı olarak imzalar.
5. Escrow ilk başarılı doğrulamada cüzdana kalıcı bağlanır. Yalnız o cüzdan SOL çeker; hesap rent bakiyesi korunur. Doğrulayıcının ayrı bir para çekme yetkisi yoktur.

**Teknik fark:** pump.fun SDK'sında `Platform.TikTok` aktif değildir. TikTok için uydurulmuş platform numarası veya pump.fun'da TikTok ile para çekme vaadi kullanılmaz. Ücret paylaşımı pump.fun programında; kullanıcı adına birikim ve çekim `programs/tiktok-escrow` içindedir.

## Çalıştırma

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Hazine ve ücretler mevcut `src/splidev.json` dosyasından okunur; eski `NEXT_PUBLIC_SPLIDEV_*` override'ları korunur. Hazine mevcut sahibin açık adresidir, yeni bir cüzdan oluşturulmaz. Anahtar/seed istemeyin veya uygulamaya koymayın.

`.env.example` gerekli değişkenleri gösterir. Boş program veya doğrulayıcı adresi ile basım kapalıdır. Basım öncesi programın seçili RPC üzerinde executable olduğu kontrol edilir. OAuth veya imzalayıcı eksikse doğrulama kapalıdır; sahte başarılı durum gösterilmez.

## Canlıya alma için gerekli gerçek altyapı

- Solana escrow programını inceleyip mainnet'e deploy edin; gerçek program adresini `NEXT_PUBLIC_TIKSPLIT_ESCROW_PROGRAM_ID` olarak ayarlayın. Program değiştirilebilir olduğu sürece upgrade authority de güvenilen bir taraftır. Bu kaynak bağımsız güvenlik denetiminden geçmiş olarak sunulmaz.
- Harici, yönetilen bir Ed25519 imzalayıcının açık anahtarını `NEXT_PUBLIC_TIKSPLIT_VERIFIER` olarak ayarlayın. İmzalayıcı API sözleşmesi aşağıdadır; bu uygulama özel anahtar barındırmaz.
- TikTok Developer Portal'da Login Kit uygulaması ve `user.info.profile` iznini onaylatın. HTTPS callback tam olarak `/api/tiktok/callback` olmalıdır. Client secret ve oturum şifreleme anahtarı hosting secret manager'da saklanır.
- RPC ve metadata depolamasını yapılandırın. Eski alan adı değişiyorsa tarayıcı RPC'sinin origin kısıtını yeni alan adı için güncelleyin.

Repo'daki `.deploy-hold`, eksik bu kurulumun mevcut Vercel yayınının yerini almasını önler. Hazır mainnet yapılandırması ve kontroller sonrasında dosyanın kaldırılması otomatik yayını açar.

## Doğrulama imzalayıcısı sözleşmesi

`POST TIKTOK_ATTESTATION_URL`, `Authorization: Bearer TIKTOK_ATTESTATION_TOKEN`, JSON:

```json
{
  "transaction": "base64 unsigned versioned transaction",
  "evidence": {
    "handle": "creator",
    "openId": "TikTok authenticated identifier",
    "wallet": "beneficiary public key",
    "verifiedAt": "ISO timestamp",
    "expiresAt": "ISO timestamp"
  },
  "walletProof": {
    "message": "exact wallet verification message",
    "signature": "base58 Ed25519 signature"
  }
}
```

Servis yalnız izin verilen program + doğrulayıcı ile oluşturulmuş init/bind talimatlarını, aynı cüzdan fee payer'ı ve doğrulanmış kimlik hash'ini kabul etmelidir. Kanıt yalnız uygulamanın doğrulanmış sunucusundan gelir; servis uç noktası halka açık istekleri kabul etmemelidir. Mesajı değiştirmeden yalnız doğrulayıcı imzasını ekler ve `{ "transaction": "base64 co-signed transaction" }` döner. Uygulama dönen işlem mesajının byte byte aynı olduğunu ve doğrulayıcı imzasını kriptografik olarak kontrol eder. Kullanıcı kalan cüzdan imzasını ekler. İşlem güncel blockhash ile sınırlıdır.

Bu repo imzalayıcı adaptörünü içerir; bağımsız imzalayıcı altyapısı ve gerçek hesap bilgileri yapılandırılmadan ana ağ doğrulaması çalışmaz.

Kullanıcı adları değişebilir. Escrow bir kullanıcı adı için ilk başarılı doğrulamada bağlanır ve ardından yeniden yönlendirilemez. OAuth, TikTok'un işlem anındaki sahipliğini kanıtlar; geçmiş sahipliği veya token'a destek verdiğini kanıtlamaz. Yeni ad yeni escrow demektir; önceki adı için bağlanmış cüzdan önceki ücretlerini almaya devam eder.

## Kontroller

```bash
npm run typecheck
npm test
npm run build
cargo test --manifest-path programs/tiktok-escrow/Cargo.toml
cargo build-sbf --manifest-path programs/tiktok-escrow/Cargo.toml
```

Yerel gerçek pump.fun programlarıyla uçtan uca test (yalnız yerel validator; throwaway test cüzdanları):

```bash
e2e/solana/validator.sh /tmp/tiksplit-ledger --bpf-program "$TEST_ESCROW_PROGRAM_ID" programs/tiktok-escrow/target/deploy/tiktok_escrow.so
node e2e/solana/build-lib.mjs
NEXT_PUBLIC_TIKSPLIT_ESCROW_PROGRAM_ID="$TEST_ESCROW_PROGRAM_ID" node e2e/solana/tiktok-local.mjs
```

Bu test gerçek token oluşturma, sabit paylaşım, ilk alım, ek alım, dağıtım, doğrulama öncesi kilit, imzalı bağlama, takeover reddi ve rent korunan çekimi kontrol eder. Gerçek TikTok OAuth canlı testi uygulama hesabı/izinleri gerektirir. Eski GitHub senaryoları tarihsel referanstır; yeni sürümün kontrolleri TikTok senaryolarını kullanır.
