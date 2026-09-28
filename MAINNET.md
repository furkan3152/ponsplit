# Mainnet'e çıkış

## Otomatik olarak doğrulananlar (her push'ta CI)

| Kontrol | Ne yapıyor |
|---|---|
| `contracts` | 25 birim testi: fee dağıtımı, eğri, mezuniyet, havuz, claim, imza reddi, sahiplik, durdurma |
| `security` | Slither statik analizi; orta ve üstü seviyede bulgu çıkarsa build kırılır |
| `chain-simulation` | Tüm yaşam döngüsü **gerçek Robinhood Chain testnet ve mainnet** üzerinde tek bir `eth_call` ile çalıştırılır: deploy, launch, eğride al/sat, mezuniyet, havuzda al/sat, imzalı claim. Hiçbir işlem gönderilmez, hiçbir şey harcanmaz. Mainnet'te toplam maliyet yaklaşık 7,9M gas. |
| `web` | Typecheck, lint ve production build |
| `chain-simulation` (derin) | Yine tek `eth_call` ile gerçek testnet ve mainnet üzerinde: 16 ayrı trader hesabı, 3 coin (biri 10 X hesabına bölünmüş), rastgele 120 adımlık al/sat fırtınası, her adımdan sonra ödeme gücü ve arz kontrolü, mezuniyet, havuz işlemleri, reddedilmesi gereken 6 saldırı (fazla satış, bilinmeyen token, slippage, claim yönlendirme, sahte ve tekrar kullanılan imza) ve her X hesabının tam payını claim etmesi. |
| `e2e-fork` | Robinhood testnet'in fork'u üzerinde production build gerçek bir tarayıcıda, birden çok cüzdanla uçtan uca test edilir: /setup deploy ve sahiplik devri, gerçek X hesabı çözümleme (@jack → 12), arayüzden launch, al/sat, mezuniyet, havuz işlemleri, post ile claim, 8 sayfa masaüstü/mobil/karanlık modda taşma ve hata kontrolü. Ekran görüntüleri artifact olarak yüklenir. |

## Mainnet öncesi yapılması gerekenler

Bu adımları kod çözemez; karar ve sorumluluk proje sahibinde.

1. **Bağımsız güvenlik denetimi (audit).** Kontratlar gerçek para tutacak. Otomatik testler ve Slither bir denetimin yerini tutmaz.
2. **Hukuki kontrol.** Token launchpad'leri birçok ülkede düzenlemeye tabi. Ayrıca herkes herhangi bir X hesabını listeleyebilir; site bunun bir onay olmadığını gösteriyor, ama taklit ve şikâyet durumları için bir kaldırma süreci planla.
3. **Rolleri ayır.**
   - `OWNER_ADDRESS`: kontratların sahibi. Senin kontrol ettiğin, tercihen bir multisig (ör. Safe) olsun.
   - Sunucudaki anahtar (`SIGNER_SEED`) yalnızca launch ve claim imzalar. Deploy sonrası `/setup` sahipliği otomatik olarak devretmeyi önerir, sen de kendi cüzdanından kabul edersin.
4. **X doğrulaması.**
   - Mainnet'te "Sign in with X" (OAuth) açılmalı: `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`.
   - Kullanıcı adını ID'ye çevirmek için resmi API kullanılmalı: `X_BEARER_TOKEN`.
   - Varsayılan fxtwitter aynası ücretsiz ama gayriresmî.
5. **Altyapı.**
   - Uyumayan bir plan kullan (`render.mainnet.yaml` "starter" plan kullanıyor).
   - Kendi alan adını bağla.
   - Özel bir RPC sağlayıcısı kullan: `NEXT_PUBLIC_RPC_URL`. Herkese açık RPC hız sınırlı.
   - Mobil cüzdanlar için `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` ekle.
6. **Parametreleri gözden geçir.** Deploy sonrası sahip `setFees` / `setCurveConfig` ile değiştirebilir. Değişiklikler yalnızca yeni coin'lere uygulanır.

   | Parametre | Varsayılan | Sınır |
   |---|---|---|
   | İşlem fee'si | %1 | en fazla %5 |
   | Protokol payı | fee'nin %20'si | en fazla %50: X hesapları her zaman en az yarıyı alır |
   | Mezuniyet ücreti | %0 | en fazla %10 |
   | Oluşturma ücreti | 0 | – |

## Mainnet deploy (Render)

1. Render → **New → Blueprint** → bu repo → **Blueprint Path:** `render.mainnet.yaml`.
2. Render `OWNER_ADDRESS` (senin multisig/cüzdan adresin) ve isteğe bağlı WalletConnect ID'yi sorar.
3. `SIGNER_SEED` otomatik üretilir. Bu değer testnet servisinden ayrıdır.
4. Site açılınca `/setup` sayfasına git:
   - Yönetici adresine ~0.01 ETH gönder (Robinhood Chain).
   - **Deploy contracts** butonuna bas.
   - **Propose new owner** ile sahipliği devretmeyi başlat.
   - Kendi cüzdanınla **Accept ownership** (iki işlem).
5. OAuth ve `X_BEARER_TOKEN` ortam değişkenlerini ekle, servisi yeniden başlat.

## Acil durum planı

| Durum | Ne yapılır (sahip cüzdanından) |
|---|---|
| Sunucu imza anahtarı sızdı | `FeeVault.setClaimsPaused(true)` → `SIGNER_SEED` değerini değiştir, yeni imzalayıcı adresiyle `FeeVault.setSigner(yeni)` → `setClaimsPaused(false)`. Bakiyeler durdurma sırasında yerinde kalır; eski imzalar geçersizleşir. |
| Kötüye kullanım / spam coin dalgası | `SplitLaunchpad.setLaunchesPaused(true)`. Mevcut coin'lerin alım satımı bilinçli olarak **durdurulamaz**, kimsenin parası içeride kilitli kalmaz. |
| Protokol gelirlerini çekmek | `SplitLaunchpad.withdrawProtocolFees(adres)` |
| Sahipliği devretmek | `transferOwnership(yeni)` → yeni adres `acceptOwnership()` (iki adımlı) |

## Tasarım gereği güven varsayımları

- **İmzalayıcı:** Kullanıcı adı → X ID eşleşmesini ve claim yetkisini imzalayan sunucuya güvenilir. İmzalayıcı ele geçirilirse biriken claim'ler yönlendirilebilir. Yukarıdaki plan bu riski sınırlar.
- **X doğrulaması:** Post ile doğrulama fxtwitter üzerinden okunur. OAuth, X'in kendi doğrulamasını kullanır.
- **Fiyatlar ETH cinsinden gösterilir;** USD için bir fiyat kaynağı (oracle) yok.
