# Poprawka przeciążenia wejść i wyceny kosztów

Baza: GitHub `6a059ea`. Osobna gałąź `fix/entry-rate-costs`. Nie wdrażano jej na VPS ani nie zmieniano tam działającego LIVE.

## Diagnoza

Raport z VPS wskazał 501 sygnałów BUY przy zerowej liczbie nadanych transakcji, odpowiedzi 429 i blokadę kosztów. W bazowej implementacji potwierdzono:

- Brak globalnego odstępu między próbami: odrzucenie kandydata umożliwiało natychmiastowe uruchomienie kolejnego odczytu i wyceny.
- Powtarzane odczyty tych samych sald oraz ponowne pobranie konta mint przez `getMint` po wcześniejszym `getAccountInfo`.
- Brak wymuszenia limitu keyless Jupiter przy ręcznym `JUPITER_RPS=1`; brak wspólnego cooldown po 429.
- Filtr kosztów kupował w symulacji ekonomicznej ilość `minOut`, a następnie używał kolejnego `minOut` przy sprzedaży. Granica dopuszczalnego wykonania była przez to traktowana jak oczekiwany koszt obu transakcji.

## Zmiany

1. Przed jakimkolwiek odczytem zewnętrznym: tylko jedna próba wejścia w toku, domyślny odstęp 6000 ms i przerwa 30000 ms dla tego samego mintu. Sygnały nadal są rejestrowane; tylko dopuszczona próba generuje `entry_admitted`. Reszta ma `entry_deferred` z powodem.
2. Cache salda 3000 ms, scalanie równoczesnych odczytów, brak używania starego wyniku po nieudanym odświeżeniu. Unieważnienie po nadaniu, potwierdzeniu lub stwierdzonym niepowodzeniu transakcji. Nowe wejścia czekają na rozliczenie istniejącej transakcji, a rezerwacje kapitału pozostają atomowe.
3. Cache istnienia ATA (3 s), rent (1 h), konfiguracji/fee Pump (30 s). Stan samej krzywej używany do wyceny jest nadal pobierany na bieżąco. Supply pochodzi ze zweryfikowanego konta mint; usunięto jego drugi odczyt. Przy budowaniu/podpisywaniu pozostaje świeża symulacja i kontrola wydatków.
4. Jupiter bez klucza jest ograniczony do maks. 0,5 RPS. Kolejka jest ograniczona i nadaje priorytet wyjściom. 429 respektuje `Retry-After` z minimum 30 s; oczekujące zbyt długo wejścia wygasają. Błąd 429 z Jupiter nie uruchamia dodatkowego odczytu krzywej jako alternatywy.
5. `Quote.expectedOutUsd` oznacza wynik oczekiwany z `outAmount`; `outUsd` nadal oznacza chroniony wynik z `otherAmountThreshold`/`minOut`. Filtr wejścia wycenia sprzedaż oczekiwanej liczby kupionych tokenów, używa oczekiwanego zwrotu do waluty wejściowej i dodaje oszacowane koszty sieci oraz rent. Fee DEX i price impact są już w kwotowaniu — nie są dodawane drugi raz.
6. Zdarzenie `entry_economics` zapisuje wejście, oczekiwany zwrot, koszty, decyzję i progi minOut. Limit kosztu pozostaje 5% według konfiguracji, podobnie jak pozostałe limity portfela i price impact. Nie podnoszono slippage. Stop-loss, recovery i paper nadal korzystają z chronionej wyceny; faktyczny PnL pochodzi z rozliczonych przepływów.

Oczekiwany koszt **nie jest gwarancją** uzyskania takiego wykonania. Rzeczywisty wynik może być gorszy w granicach ustawionego slippage. Istniejące limity `minOut`, symulacja, limit ekspozycji i rezerwa na sprzedaż pozostają konieczne.

## Walidacja

- `npm run check`, `npm run build` — zaliczone.
- `npm test` — **30/30**, w tym 13 nowych regresji.
- 40 równoczesnych sygnałów różnych mintów: jedna dopuszczona próba, dwa wywołania adaptera kwotowania (wejście i analiza wyjścia); pozostałe sygnały nie wykonały odczytów portfela ani wycen.
- Wzorzec 5% slippage: przy wkładzie 2 USD, oczekiwanym zwrocie 1,995 USD i łącznej estymacie opłat 0,02 USD oczekiwany koszt wynosi 0,025 USD (1,25%). Test potwierdza akceptację przy limicie 5% i zachowanie minOut. Koszt rzeczywiście przekraczający 5% nadal jest odrzucany.
- Sprawdzono cache rzeczywistego adaptera ChainExecutor na atrapach RPC, ponowne odczyty po unieważnieniu, brak podwójnego pobrania mintu oraz obsługę Retry-After.
- Dwa rzeczywiste, równocześnie zlecone odczyty Jupiter V2 zakończyły się sukcesem przez nową kolejkę: mimo zadanej konfiguracji 1 RPS efektywny limit keyless wynosił 0,5 RPS. Nie podpisano ani nie nadano transakcji. Wynik: `validation/entry-quotes.json`.

Nie wykonano testu Helius ani LIVE na VPS. Ograniczenia innych procesów i wspólnego IP mogą nadal powodować 429. Poprawka nie gwarantuje, że po jej wdrożeniu pojawi się ekonomicznie uzasadniony zakup.

## Scalenie z lokalnymi zmianami VPS

Użytkownik przekazał identyfikatory nieopublikowanych commitów: `cb443d3`, `c9af469`, `6895fe8`. Ich treści nie były dostępne w tym środowisku. **Nie resetować checkoutu VPS ani nie nadpisywać go gałęzią poprawki.**

Przy scalaniu trzeba zachować diagnostykę symulacji oraz preferowanie krzywej przed migracją z lokalnych zmian Claude. W obu ścieżkach adaptera należy dodać `expectedOutUsd`, zachowując `outUsd` jako minOut. Miejsca dotyczące pobierania stanu krzywej i supply w execution.ts mogą wymagać ręcznego rozwiązania konfliktu.

Do wiernego połączenia historii po stronie GitHub potrzebne są pliki `.patch` lub inne udostępnienie treści tych commitów; same hashe i ścieżka `/tmp` na innym serwerze nie wystarczają. W tym środowisku działa już zapis HTTPS do wskazanego repozytorium, więc import łatek nie wymaga tworzenia kolejnego klucza wdrożeniowego.
