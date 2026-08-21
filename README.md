# HENNA10 – automatyczne naliczanie prowizji afiliacyjnej

Ten mini-projekt liczy prowizję dla programu afiliacyjnego EXTENSIONS HAIR SHOP
(kod rabatowy `HENNA10`) i publikuje stronę podglądu, na której partnerka widzi
swoje zamówienia i saldo kredytu – bez możliwości niczego zmienić.

Działa w tym samym stylu, co `omnibus-price-tracker`: GitHub Actions uruchamia
skrypt Node.js na harmonogramie (cron), skrypt rozmawia z Shopify Admin API
przez custom app (client credentials grant) i sam commituje wyniki do repo.

## Jak to działa (krótko)

1. Raz w miesiącu (albo częściej – patrz `.github/workflows/henna10-commission.yml`)
   GitHub odpala `scripts/compute-commission.mjs`.
2. Skrypt pobiera z Shopify zamówienia z kodem `HENNA10` złożone od ostatniego
   przetworzonego zamówienia.
3. Liczy 5% od wartości każdego zamówienia po rabacie (bez wysyłki).
4. Dopisuje to do "zaległej" prowizji na koncie klienta-partnerki w Shopify
   (metapola w namespace `affiliate`).
5. Jeśli zaległa prowizja przekroczy **po raz pierwszy** 50 EUR – cała suma
   staje się realnym kredytem w sklepie (Shopify Store Credit). Od tego
   momentu każda kolejna prowizja trafia na kredyt od razu, bez czekania na
   kolejne 50 EUR.
6. Generuje `docs/index.html` – stronę tylko do odczytu (GitHub Pages),
   z listą zamówień i aktualnym saldem.

Pełna instrukcja konfiguracji krok po kroku: [`SETUP.md`](./SETUP.md).

## Pliki

- `scripts/compute-commission.mjs` – właściwy skrypt (jedyny, który się liczy).
- `scripts/test-mock-run.mjs` – lokalny test na sztucznych danych (bez
  łączenia się z prawdziwym Shopify) – pokazuje, że logika progu 50 EUR
  działa tak jak ma działać.
- `scripts/gen-initial-placeholder.mjs` – wygenerował startową, pustą wersję
  `docs/index.html` (użyty jednorazowo, można zignorować).
- `data/henna10_orders.json` – historia przetworzonych zamówień (źródło dla
  strony podglądu).
- `docs/index.html` – strona podglądu dla partnerki (GitHub Pages).
- `.github/workflows/henna10-commission.yml` – harmonogram + logika uruchamiania.
