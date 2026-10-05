# Splidev

Splidev, **pump.fun** (Solana) üzerinde coin basan ve coin'in yaratıcı ücretlerini **GitHub
hesapları** arasında bölen bir launchpad. Bir coin basarken en fazla 9 GitHub kullanıcı adı ve
payları seçilir; coin'in her alım satımından gelen yaratıcı ücreti bu geliştiricilere akar.

Splidev pump.fun ile bağlantılı değildir; pump.fun'ın herkese açık programlarını kullanır.

## Nasıl çalışır

1. **Basım.** /create sayfasında isim, sembol, resim, GitHub kullanıcı adları ve paylar girilir.
   Cüzdan tek seferde imzalar:
   - pump.fun `create_v2` (+ isteğe bağlı ilk alım), yaratıcı = basan cüzdan;
   - eksik GitHub ücret hesapları (pump.fun'ın kendi GitHub hesapları, kullanıcı id'sine bağlı);
   - kalıcı ücret paylaşımı: önce Splidev hazinesi (`platformBps`, şimdi %10), kalanı GitHub
     hesaplarına; yönetici yetkisi kaldırılır, paylar bir daha değişmez;
   - basım ücreti (`launchFeeSol`, şimdi 0.01 SOL) hazineye.
2. **Alım satım.** Coin sayfasında bonding curve üzerinde, mezuniyetten sonra pump.fun'ın
   havuzunda (PumpSwap) alım satım yapılır.
3. **Ücretler.** pump.fun'ın yaratıcı ücreti coin'in kasasında birikir. Coin sayfasındaki
   **"Distribute now"** düğmesi (herkes basabilir) bunu paylara göre dağıtır.
4. **Para alma.** Geliştiriciler paralarını **pump.fun'da GitHub ile giriş yaparak** alır. Splidev'in
   ayrı bir sözleşmesi ya da imza anahtarı yoktur. /claim sayfası bir GitHub kullanıcısının ne kadar
   alabileceğini ve hangi coin'lerden geldiğini gösterir.

## Ayarlar

`src/splidev.json`:

| Alan | Anlamı |
| --- | --- |
| `treasury` | Splidev'in Solana cüzdan adresi (boşken basım kapalı) |
| `platformBps` | Splidev payı, baz puan (1000 = %10) |
| `launchFeeSol` | Basım ücreti, SOL |
| `hidden` | Sitede gösterilmeyecek coin adresleri |
| `officialToken` | Resmi coin adresi (boş = "Coming soon") |

Vercel ortam değişkenleri:

- `NEXT_PUBLIC_SOLANA_RPC_URL`: tarayıcıların RPC'si (domain kısıtlı ücretli anahtar önerilir)
- `SOLANA_RPC_URL`: sunucu RPC'si
- `GITHUB_TOKEN`: GitHub kullanıcı aramaları için (yetkisiz/scope'suz bir token yeterli)
- `BLOB_READ_WRITE_TOKEN`: coin resimleri ve metadata için Vercel Blob

## Yayına alma (sahibin adımları)

1. Hazine için Phantom/Solflare'de bir Solana adresi kopyala ve bana gönder (yalnızca adres,
   asla gizli anahtar ya da kelimeler).
2. Vercel → ponsplit → Settings → Environment Variables: yukarıdaki RPC ve `GITHUB_TOKEN`
   değerlerini ekle.
3. Bana "yayına al" de: `.deploy-hold` dosyasını kaldırıp siteyi Splidev'e çeviririm.

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
```

CI (`splidev.yml`): `pump-local` (yukarıdaki testler), `web` (tip, lint, birim, build) ve
`browser` (Chromium'da /create üzerinden gerçek bir basım, alım satım, dağıtım ve /claim).
