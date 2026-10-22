# Splitdev

Splitdev, **pump.fun** (Solana) üzerinde coin basan ve coin'in yaratıcı ücretlerini **GitHub
hesapları** arasında bölen bir launchpad. Bir coin basarken en fazla 9 GitHub kullanıcı adı ve
payları seçilir; coin'in her alım satımından gelen yaratıcı ücreti bu geliştiricilere akar.

Splitdev pump.fun ile bağlantılı değildir; pump.fun'ın herkese açık programlarını kullanır.

12 Ekim 2026: GitHub sürümü (`8806e4c`) ve Splitdev tasarımı geri getirildi. Güncel pump.fun
programları için ücretlerin curve/pool hesaplarından aktarılması ve güncel işlem geçmişi
okuma düzeltmeleri korundu. Canlı adres **https://splitdev.app**; `www` bu adrese yönlenir.
Ücretsiz RPC kullanılır: tarayıcıda PublicNode, sunucudaki hesap taramasında Solana public mainnet.
`SITE_URL` ve sitemap için `NEXTAUTH_URL` aynı canlı adrese ayarlanır.

## Nasıl çalışır

1. **Basım.** /create sayfasında isim, sembol, resim, GitHub kullanıcı adları ve paylar girilir.
   Cüzdan tek seferde imzalar:
   - pump.fun `create_v2` (+ isteğe bağlı ilk alım), yaratıcı = basan cüzdan;
   - eksik GitHub ücret hesapları (pump.fun'ın kendi GitHub hesapları, kullanıcı id'sine bağlı);
   - kalıcı ücret paylaşımı: önce Splitdev hazinesi (`platformBps`, şimdi %10), kalanı GitHub
     hesaplarına; yönetici yetkisi kaldırılır, paylar bir daha değişmez;
   - basım ücreti (`launchFeeSol`, şimdi 0.01 SOL) hazineye.
2. **Alım satım.** Coin sayfasında bonding curve üzerinde, mezuniyetten sonra pump.fun'ın
   havuzunda (PumpSwap) alım satım yapılır.
3. **Ücretler.** pump.fun'ın yaratıcı ücreti coin'in kasasında birikir. Coin sayfasındaki
   **"Distribute now"** düğmesi (herkes basabilir) bunu paylara göre dağıtır.
4. **Para alma.** Geliştiriciler paralarını **pump.fun'da GitHub ile giriş yaparak** alır. Splitdev'in
   ayrı bir sözleşmesi ya da imza anahtarı yoktur. /claim sayfası bir GitHub kullanıcısının ne kadar
   alabileceğini ve hangi coin'lerden geldiğini gösterir.

## Ayarlar

`src/splidev.json`:

| Alan | Anlamı |
| --- | --- |
| `treasury` | Splitdev'in Solana cüzdan adresi (boşken basım kapalı) |
| `platformBps` | Splitdev payı, baz puan (1000 = %10) |
| `launchFeeSol` | Basım ücreti, SOL |
| `hidden` | Sitede gösterilmeyecek coin adresleri |
| `officialToken` | Resmi coin adresi (boş = "Coming soon") |

Vercel ortam değişkenleri:

- `NEXT_PUBLIC_SOLANA_RPC_URL`: tarayıcı RPC'si (`https://solana-rpc.publicnode.com`)
- `SOLANA_RPC_URL`: hesap taraması destekleyen sunucu RPC'si (`https://api.mainnet-beta.solana.com`)
- `SITE_URL` ve `NEXTAUTH_URL`: `https://splitdev.app`
- `GITHUB_TOKEN`: GitHub kullanıcı aramaları için (yetkisiz/scope'suz bir token yeterli)
- `BLOB_READ_WRITE_TOKEN`: coin resimleri ve metadata için Vercel Blob

## Yayın ayarları (12 Ekim 2026)

- Üretim alan adı **splitdev.app**; `www.splitdev.app` bu adrese yönlenir.
- Hazine: `D2Ts7yCiVjedo6uwqpkM44QA8J45NdVU1J3k5m6iWtvm`.
- RPC: ücretsiz PublicNode ve Solana mainnet; eski QuickNode bağlantıları kullanılmaz.
- Önerilen adım: GitHub → Settings → Developer settings → Personal access tokens → "Generate new token"
  (hiçbir izin seçme), çıkan değeri Vercel → ponsplit → Settings → Environment Variables'a `GITHUB_TOKEN`
  adıyla ekle. Böylece GitHub aramaları saatte 60 yerine 5.000 olur.

## Geliştirme

```bash
npm ci
npx tsc --noEmit && npx next lint && npm test   # tip kontrolü, lint, birim testleri
npm run build
```

Testler pump.fun'ın **gerçek** programlarıyla, yerel bir `solana-test-validator` üzerinde çalışır
(programlar ve hesaplar `e2e/solana/fixtures` içinde, `solana-fixtures.yml` ile mainnet'ten alınır):

```bash
e2e/solana/validator.sh /tmp/ledger     # pump.fun programlarıyla yerel validator
node e2e/solana/build-lib.mjs
node e2e/solana/launch-local.mjs        # basım, alım satım, dağıtım
node e2e/solana/graduate-local.mjs      # mezuniyet, havuz alım satımı
node e2e/solana/github-fee-compat-local.mjs # güncel creator-fee kasaları, 9 alıcı ve devam etme
```

CI (`splidev.yml`): `pump-local` (yukarıdaki testler), `web` (tip, lint, birim, build) ve
`browser` (Chromium'da /create üzerinden gerçek bir basım, alım satım, dağıtım ve /claim).
