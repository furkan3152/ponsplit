<p align="center"><img src="public/hero.svg" width="480" alt="PonsEarn"></p>

# PonsEarn

**Tek coin, birden fazla X hesabı, fee'ler otomatik bölünür.** Robinhood Chain üzerinde, **pons** (ponsfamily.com) altyapısında bir coin çıkar. Coin'in creator fee'leri, seçtiğin en fazla 10 X (Twitter) hesabı arasında paylaştırılır. Bu hem bonding curve aşamasında hem de coin Uniswap v4 havuzuna "mezun olduktan" sonra geçerli. Hesap sahipleri hesabın kendilerine ait olduğunu kanıtlayıp paylarını istedikleri cüzdana çeker.

PonsEarn bağımsız bir uygulamadır; pons ile resmi bir bağı yoktur, pons tarafından onaylanmamış ya da işletilmemektedir.

```
src/, public/        Next.js 14 web uygulaması (repo kökü: Vercel ek ayar istemez)
contracts/           Solidity (Hardhat): PonsEarnLauncher, FeeSplitter, FeeVault, PonsEarnRouter
contracts/vendor/    pons v2 ve Uniswap v4'ün Blockscout'ta doğrulanmış kaynakları (birebir derlenir)
e2e/                 Playwright uçtan uca testleri (gerçek ağların fork'u üzerinde)
.github/             CI, inceleme ve teşhis iş akışları
```

## İki ağ: Mainnet ve Testnet

Site iki ağı aynı anda sunar; her sayfanın üstündeki **Main / Test** seçicisiyle geçilir (seçim bir çerezde durur, `?network=testnet` bağlantıları da ağı seçer).

- **Mainnet (4663):** coin'ler gerçek pons'ta çıkar.
- **Testnet (46630):** pons testnet'te yok. Bu yüzden PonsEarn, pons'un açık kaynaklı v2 kontratlarının birebir kopyasını testnet'e kurar (pons'un mainnet ayarlarıyla), Robinhood testnet'teki gerçek Uniswap v4'ün üzerine. Kurulumu sahip kendi cüzdanıyla `/setup`'tan yapar.

## Nasıl çalışır?

1. **Launch:** İsim, ticker, görsel, açıklama/linkler ve en fazla 10 X hesabıyla payları girilir.
   - Sunucu kullanıcı adlarını **kalıcı X kullanıcı ID'lerine** çevirir ve bu eşleşmeyi imzalar (attestation). FeeVault imzayı doğrulamadan coin'i kaydetmez.
   - Coin'i pons'un kendi fabrikası basar; normal bir pons coin'idir (1B arz). Tek fark, creator fee alıcısının coin'e özel bir **FeeSplitter** olması.
   - İsteğe bağlı **creator vergisi** (%0–10, varsayılan 0) ve aynı işlemde **ilk alım** (pons'un açılış snipe vergisinden muaf).
2. **Fee'ler:** Her al/sat işleminde pons'un **%1 fee'si** kesilir: %30'u pons'a, %70'i creator payına gider. Creator payının **%80'i X hesaplarına, %20'si PonsEarn'e** gider. Creator vergisinin **tamamı** X hesaplarınındır. Oranlar launch anında coin'e sabitlenir.
3. **Mezuniyet (pons usulü):** Eğri 4,2 ETH toplayınca kapanır; ETH ve ayrılmış token'lar kilitli likiditeyle bir **Uniswap v4 havuzuna** konur. Havuzu pons genelde hemen açar; açmazsa coin sayfasındaki **Create the pool** düğmesiyle herkes açabilir. İşlemler aynı sayfada, PonsEarn'ün router'ı üzerinden devam eder; havuz fee'leri de aynı hesaplara gider.
4. **Claim:** `/claim` sayfasında hesap sahipliği kanıtlanır:
   - **Varsayılan:** tek kullanımlık kod içeren bir post atılıp linki yapıştırılır. Kod kullanıcı adına, cüzdana ve güne bağlı bir HMAC'tir. Post, hesabın kendi attığı yeni bir post olmalı ve metni tam olarak gösterilen metin olmalı; yanıtlar, alıntılar ve kodu sadece içeren postlar sayılmaz.
   - **Opsiyonel:** X anahtarları verilirse "Sign in with X" (OAuth).

   Sunucu o hesabın ID'si için hedef cüzdana bağlı, 15 dakika geçerli bir imza üretir. Claim işlemi coin'lerde bekleyen son fee'leri de aynı işlemde toplar (`collectAndClaim`) ve birikmiş ETH'yi cüzdana gönderir.
5. **Grafik ve işlem geçmişi:** Eğri işlemleri ve havuz swap'ları zincir üstü event'lerden okunur (indexer gerekmez).

### Güvenlik notları

- Launch attestation'ı ve claim imzaları iki ağda da aynı `SIGNER_PRIVATE_KEY` ile atılır (imza alanı ağa ve FeeVault adresine bağlıdır). Bu anahtar yalnızca sunucuda durur, para tutmaz ve hiçbir kontratın sahibi değildir. Sızarsa sahip `FeeVault.setSigner` ile değiştirir.
- Kontratların sahibi, onları `/setup`'tan deploy eden **kendi cüzdanındır**; özel anahtarı cüzdandan hiç çıkmaz.
- Attestation coin'i oluşturan adrese bağlıdır ve 30 dakikada geçerliliğini yitirir.
- X ID çözümlemesi resmi X API ile (`X_BEARER_TOKEN`) ya da ücretsiz, gayriresmî `api.fxtwitter.com` üzerinden yapılır. İkincisi "best effort" çalışır; ciddi kullanımda resmi API önerilir.
- Coin'ler pons'un kurallarına tabidir (ör. pons'un topluluk devri akışı bir coin'in creator fee'lerini başka bir adrese taşıyabilir; coin sayfası bunu gösterir).
- PonsEarn kontratları denetimden (audit) geçmedi. Mainnet öncesinde audit ve hukuki kontrol şart.

## Kurulum

Adım adım rehber, kontrol listesi ve acil durum planı: **[MAINNET.md](MAINNET.md)**. Kısaca:

1. Siteyi Vercel'de yayınla (repo kökü, ek ayar yok).
2. `/setup` → **Generate signing key** → Vercel'e `SIGNER_PRIVATE_KEY` olarak ekle → Redeploy.
3. Üstten ağı seç, `/setup`'ı cüzdan uygulamanın tarayıcısında aç → **Deploy**. Testnet'te 19 işlem (pons kopyası + PonsEarn), mainnet'te 3 işlem. Yarıda kalırsa sayfa kaldığı yerden devam eder.
4. `/setup`'ın gösterdiği adresleri `src/deployment.json`'a yaz (ya da Vercel ortam değişkeni olarak ekle). Site yeniden build olunca o ağ canlıdır.

Opsiyonel ortam değişkenleri `.env.example` dosyasında (`TWITTER_CLIENT_ID/SECRET`, `X_BEARER_TOKEN`, `PINATA_JWT`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, ağ başına RPC).

## Geliştirme

```bash
cd contracts && npm install
npx hardhat test              # 27 test: gerçek pons v2 + Uniswap v4 + Permit2 kodu üzerinde
node vendor/build.js          # vendor/out: doğrulanmış kaynaklardan birebir derleme (CI kontrol eder)
node scripts/export-abi.js    # src/lib/abi.ts + bytecode.ts (CI kontrol eder)
FORK_URL=https://rpc.mainnet.chain.robinhood.com npx hardhat test test/fork/PonsMainnet.fork.test.js

cd .. && npm install
npx tsc --noEmit && npx next lint && npm test
```

Uçtan uca testler gerçek ağların fork'u üzerinde çalışır (CI `e2e` işi): `hardhat node --fork <rpc>` (+ `HARDHAT_CHAIN_ID`), `e2e/prepare-fork.mjs`, site `NEXT_PUBLIC_<AĞ>_RPC_URL=http://127.0.0.1:8545` ile build edilir, `e2e/setup.mjs` `/setup`'tan cüzdanla deploy eder, adresler sabitlenip yeniden build edilir ve `e2e/full.mjs` gerçek X hesaplarıyla launch, eğri, mezuniyet, havuz, fee ve claim akışlarını dener. Sahte (mock) veri kullanılmaz.

## Tasarım

"Split terminal": neredeyse siyah zemin, film grain, Robin-neon lime `#ccff00` ve X hesapları için pastel renkler. Açık "paper edition" temayla birlikte gelir. Görseli olmayan her coin, adresinden türetilen benzersiz bir sticker avatar alır. Tüm çizimler `src/components/art/` altında SVG React bileşenleridir.
