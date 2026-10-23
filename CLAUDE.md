# Kontynuacja na VPS — Solana Profit Engine V1

To NOWY projekt. Nie używaj kodu wcześniejszych botów użytkownika jako podstawy. Nie kasuj ani nie zatrzymuj innych usług. Wykorzystaj checkout tej gałęzi; nie twórz worktree bez polecenia użytkownika. Sekrety pozostają poza Git i logami. Nie wypisuj `.env` ani całego środowiska.

Najpierw przeczytaj README.md, SPECIFICATION.md i VALIDATION.md. W tym repozytorium nie potwierdzono jeszcze kompletnego LIVE ani rentowności. Nie nazywaj testów z atrapami testem rzeczywistej sprzedaży lub migracji na mainnet.

## Kolejne zadania w ustalonej kolejności

1. Odtwórz build/testy i sprawdź źródła na VPS. Nie zakładaj, że port 8787 jest wolny; wybierz osobny projekt Compose, wolumen i port hosta. Utrzymuj Node 24. Nie nadpisuj istniejących sekretów, konfiguracji proxy ani usług.
2. Sprawdź aktualny `npm audit --omit=dev`. Pozostały znane problemy transytywnych bibliotek SDK (m.in. bigint-buffer/Anchor TOML); ustal realną ścieżkę wykonania i wspierane poprawki. Nie instaluj losowych forków ani nie rób downgrade SDK do starych protokołów tylko w celu uzyskania zielonego audytu. Nie włączaj LIVE przed rozstrzygnięciem istotnych ryzyk.
3. Uruchom OBSERVE na rzeczywistych danych. Zmierz opóźnienia, luki WS i limity RPC. Kod grupuje metadane mintów; publiczny RPC wcześniej zwracał 429. Pokaż pomiar uzasadniający potrzebę innego dostawcy, zanim wprowadzisz płatne API.
4. Dodaj integracyjne testy podpisywania, kompilacji LUT, symulacji, sald, ATA rent i błędów prawdziwych SDK/RPC, z bezpiecznym adapterem testowym. Obecne scenariusze finansowe i test migracji używają kontrolowanych kwotowań i atrap. Wyjście po rzeczywistej migracji nie zostało jeszcze dowiedzione.
5. Przejrzyj `execution.ts` i `engine.ts`, w szczególności ekonomię $2, pochodzenie ceny USD, koszt rzeczywistego ATA, dozwolone instrukcje, wygasłe blockhash i nieznane potwierdzenia. Aktualny adapter transakcji obsługuje v0; v1 odrzuca jawnie. Direct curve obsługuje wyłącznie SOL quote. PumpSwap/pozostałe DEX są obsługiwane tylko wtedy, gdy istnieje poprawna droga Jupiter.
6. Dokończ post-migration/scalp entry oraz badanie jakości sygnałów. Nie oznaczaj ich aktywnymi tylko dlatego, że istnieją parametry w `policy.ts`. Rejestruj także przegrane i odrzucone tokeny. Dodaj chronologiczny replay rzeczywiście zebranych danych z modelem kosztów i wykonania; ten eksperyment jeszcze nie istnieje.
7. Portfele: użytkownik chce z rosnącego tokena znajdować największego rzeczywistego zarabiającego, śledzić jego nowe wejścia i testować je kwotą $2. `wallets.ts` ma wyłącznie częściową historię strumienia; `Sources.watchWallet` obserwuje do 3 adresów. Dokończ pełną weryfikację zrealizowanego PnL, opłat sieciowych, wcześniejszych zapasów/transferów, powiązań twórcy i wyników poza tokenem zwycięskim. Nie uznawaj częściowego lidera za globalnego najlepszego tradera. Dopiero zweryfikowany sygnał może przejść zwykłe ograniczenia kosztów i kapitału; nowe wejście nie może omijać braku drogi sprzedaży.
8. LIVE wymaga dedykowanego portfela, pliku keypair poza repozytorium, jawnego trybu i limitu finansowania. Brak jakiejkolwiek automatycznej wypłaty na zewnętrzny adres. Nie przełączaj istniejącego bota na ten projekt. Jeśli użytkownik dostarczy bezpiecznie wymagania i potwierdzi ograniczony test, wykonaj minimalny zakup i sprzedaż, zapisz signature i finalized przepływy. Nie raportuj PnL LIVE przed taką walidacją.

## Ważne ograniczenia bieżącej implementacji

- MAX_DAILY_LOSS_USD oznacza ruchome 24 h według czasu potwierdzonego fill oraz kosztów rewertów, nie dobę kalendarzową. Przed migracją bazy z wcześniejszej wersji zweryfikuj zgodność tabeli realizations z fills.
- Program nie ma niezależnego raportu expectancy na rzeczywistym zbiorze danych. Panel pokazuje tylko obliczalne metryki; brak dowodu przewagi strategii.
- Przerwy WebSocket są raportowane, ale bez automatycznego historycznego backfill. Nie deklaruj kompletności danych portfeli.
- Paper jest rozliczeniem minOut z bieżących kwotowań i estymat, nie symulacją MEV i lądowania transakcji.
- Brak zgody na kopiowanie dowolnego portfela z niezweryfikowaną historią w LIVE.

Zapisuj każdą istotną zmianę i wynik komendy w WORKLOG.md. Utrzymuj faktyczny stan i bloki. Celem pozostaje pełny system opisany w specyfikacji, a nie zakończenie na tym szkielecie.
