# Konfiguracja krok po kroku (HENNA10)

To jest instrukcja dla Ciebie, Magda – jeden krok na raz, bez zakładania,
że znasz się na programowaniu. Ja przygotowałam wszystkie pliki i logikę;
Twoje kroki to tylko te, które wymagają Twojego zalogowania.

Zajmie to około 10–15 minut, raz. Potem wszystko działa samo.

> **FAZA A jest już zrobiona.** Repozytorium `henna10-affiliate` (publiczne –
> zgodnie z Twoim wyborem, żeby uruchomienia Actions były bez limitu minut)
> istnieje na Twoim koncie GitHub, a wszystkie pliki są już wgrane. Zaczynasz
> od Fazy B.

---

## FAZA B – nowa aplikacja w Shopify Dev Dashboard

To dokładnie ten mechanizm, o którym już wiesz z Twoich notatek: Client ID +
Client Secret, które się nie wygasają, a token do API skrypt sam sobie
odświeża.

**B1.** Zaloguj się do [Shopify Dev Dashboard](https://dev.shopify.com/dashboard).

**B2.** Utwórz nową aplikację (np. "HENNA10 Affiliate Tracker").

**B3.** W ustawieniach uprawnień (Access scopes / Configuration) wyszukaj i
zaznacz (potrzebujemy odczytu i zapisu tam, gdzie to zaznaczone):

- **Orders** – odczyt (read)
- **Customers** – odczyt i zapis (read + write) – potrzebne, żeby zapisywać
  saldo prowizji na koncie partnerki
- **Discounts** – odczyt (read)
- **Store credit account transactions** – odczyt i zapis (read + write) –
  to jest to, co pozwala dopisywać realny kredyt w sklepie

Jeśli nazwy w interfejsie będą wyglądać nieco inaczej – wpisz w polu
wyszukiwania uprawnień słowa "customer", "order", "discount", "store
credit" i zaznacz opcje odczytu/zapisu, które się pojawią.

**B4.** Zainstaluj tę aplikację w sklepie EXTENSIONS HAIR SHOP (przycisk
"Install app" / "Select store").

**B5.** Po instalacji znajdziesz w panelu aplikacji **Client ID** i **Client
secret**. Skopiuj obie wartości – wkleisz je w Fazie D. Nie wysyłaj mi ich
w tym czacie – to dane, które powinny trafić tylko do ustawień GitHub.

---

## FAZA C – Secrets i Variables w GitHub

To miejsce, gdzie repozytorium bezpiecznie przechowuje dane wrażliwe
(Client ID/Secret) i konfigurację (które nie są tajne, np. domena sklepu).

**C1.** W repozytorium na GitHub wejdź w: **Settings → Secrets and
variables → Actions**.

**C2.** Zakładka **Secrets** → "New repository secret" → dodaj dwa:

| Nazwa | Wartość |
|---|---|
| `SHOPIFY_CLIENT_ID` | Client ID z Fazy B5 |
| `SHOPIFY_CLIENT_SECRET` | Client secret z Fazy B5 |

**C3.** Zakładka **Variables** → "New repository variable" → dodaj:

| Nazwa | Wartość |
|---|---|
| `SHOPIFY_STORE_DOMAIN` | `c2cae8-b1.myshopify.com` |
| `AFFILIATE_CUSTOMER_ID` | `gid://shopify/Customer/10963720241494` |
| `DISCOUNT_CODE` | `HENNA10` |
| `COMMISSION_RATE` | `0.05` |
| `THRESHOLD_AMOUNT` | `50` |
| `CURRENCY_CODE` | `EUR` |

(`AFFILIATE_CUSTOMER_ID` to już istniejące konto klienta partnerki –
henna@rootsandharmony.se – które sprawdziłam w Twoim sklepie.)

---

## FAZA D – włączenie strony podglądu (GitHub Pages)

**D1.** W repozytorium: **Settings → Pages**.

**D2.** W sekcji "Build and deployment" wybierz źródło: **Deploy from a
branch**, branch: **main**, folder: **/docs**. Zapisz.

**D3.** Po chwili GitHub pokaże Ci link, np.
`https://twoja-nazwa.github.io/henna10-affiliate/`. To jest link, który
przekażesz partnerce – strona tylko do odczytu, automatycznie aktualizowana.

---

## FAZA E – pierwszy test

**E1.** W repozytorium wejdź w zakładkę **Actions**.

**E2.** Po lewej wybierz workflow "HENNA10 – naliczanie prowizji
afiliacyjnej".

**E3.** Kliknij "Run workflow" (uruchomienie ręczne, nie trzeba czekać na
harmonogram).

**E4.** Sprawdź log – powinno pojawić się coś w stylu "HENNA10: gotowe." bez
błędów na czerwono. Jeśli pojawi się błąd – wklej go do mnie, rozszyfruję co
poszło nie tak.

**E5.** Odśwież stronę z Fazy D3 – powinny być widoczne aktualne dane
(na razie pewnie "No orders with code HENNA10 yet", jeśli nikt jeszcze nie
kupił z tym kodem).

---

## Harmonogram

Domyślnie skrypt uruchamia się **automatycznie co godzinę** (sprawdza, czy
są nowe zamówienia z kodem HENNA10). To najbliżej "na bieżąco", jak da się
uzyskać bez dodatkowej infrastruktury typu webhook. Jeśli wolisz rzadziej
(np. raz dziennie albo raz w tygodniu) – napisz, to jedna linijka do zmiany
w pliku `.github/workflows/henna10-commission.yml` (linia zaczynająca się
od `cron:`).

## Co zrobić, gdy coś się zmieni

- **Partnerka zmienia próg / stawkę prowizji** → zmieniamy wartości
  `COMMISSION_RATE` / `THRESHOLD_AMOUNT` w Variables (Faza C3), bez zmiany
  kodu.
- **Nowy Client Secret** (np. po rotacji) → aktualizujemy Secret w Fazie C2.
- **Chcesz zobaczyć podgląd od razu, bez czekania na najbliższą pełną
  godzinę** → Faza E, "Run workflow" można kliknąć w każdej chwili.
