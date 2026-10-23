# Solana Profit Engine V1

Nowy, niezależny projekt TypeScript / Node 24. Oddzielny katalog, baza SQLite WAL i proces. Nie zawiera kodu poprzednich botów użytkownika ani kopii silnika Chainstack.

**Status: implementacja rozwojowa; domyślnie OBSERVE. Nie jest jeszcze zweryfikowanym produkcyjnym botem LIVE ani dowodem rentowności.** Zestaw testów scenariuszy korzysta z kontrolowanych danych i atrap wykonania. Stan sprawdzeń oraz konkretne ograniczenia opisuje [VALIDATION.md](VALIDATION.md).

## Co jest zaimplementowane

- Discovery przez oficjalny strumień logów Solana Pump.fun z dekoderami aktualnego SDK, DexScreener profiles/boosts oraz GeckoTerminal new/trending pools.
- Bootstrap metadanych mintów grupowymi odczytami RPC; reconnect WebSocket, heartbeat, bounded candidate list i jawne raportowanie przerw w strumieniu.
- Chronologiczne okna obserwacji oraz reguły launch, breakout, momentum, runner i pullback. Decyzje BUY/WATCH/REJECT mają uzasadnienia. Zbiory danych różnych źródeł nie są mieszane w jedno okno wolumenu.
- Jupiter **Swap API V2 `/build`**, kompilacja v0 z LUT pobranymi z blockchaina, lokalna symulacja, sprawdzenie wydatków i odbiorcy oraz zapis podpisanej transakcji przed nadaniem. Bezpłatny limit żądań jest jawnie ograniczony do 0,5 RPS.
- Adapter bonding curve oparty o oficjalny `@pump-fun/pump-sdk`, domyślnie wyłączony i ograniczony do SOL quote. Po migracji sprzedaż szuka aktualnej drogi przez Jupiter; nie zakłada istnienia puli.
- Zakup nominalnie za 2 USD według świeżego kursu quote/USD. Budżet obejmuje koszty i rezerwę SOL. Test kwotowania wejścia i wyjścia odrzuca ekonomicznie nieuzasadniony zakup.
- Trwałe pozycje, blokada duplikatów i rezerwacja kapitału w transakcji SQLite, lease procesu, rekonsyliacja signature/salda, ponowienie tych samych podpisanych bajtów przy nieznanym statusie.
- Odzyskanie wkładu przy domyślnym 3x, wielkość częściowej sprzedaży liczona z kwotowań netto, osobna drabinka 5x/10x/20x i trailing. Odzyskany kapitał jest potwierdzany wyłącznie po rozliczeniu fill.
- Cena wykonalnego wyjścia do decyzji stop/stagnation; brak drogi sprzedaży oznacza `null` i alert, nie fikcyjną wartość gotówkową.
- Zapis faktycznych przepływów tokenów i SOL z finalized transakcji; rozróżnienie kosztów sieci/rent od kwot swapu i uwzględnienie opłat rewertów. Konwersja USD opiera się na obserwowanym FX, a nie stałym kursie SOL.
- Podgląd WWW tylko do odczytu, Bearer token, domyślny loopback; tryby observe/paper/live mają osobne bazy. Docker ma osobny wolumen, ograniczenia zasobów i restart policy.
- Eksperymentalny research portfeli: obserwowany zrealizowany wynik per mint, wybór lidera obserwacji tokena trending/gainer i obserwacja jego nowych swapów. Historia częściowa jest jawnie oznaczona. **Nie ma automatycznego kopiowania LIVE portfela uznanego za skuteczny na podstawie niepełnych danych.**

## Granice zakresu

Scalping i odrębna strategia post-migration mają parametry cyklu pozycji, ale **nie mają jeszcze aktywnych, zweryfikowanych reguł wejścia**. Migracja jest wykrywana i testowana jako zmiana routingu wyjścia. To różne funkcjonalności.

Boost DexScreener jest płatną promocją, nie dowodem popytu; oznacza tylko źródło kandydata. System nie udaje, że pobiera globalny ranking wszystkich top gainers. Obserwuje uniwersum dostarczone przez dostępne źródła i rejestruje ich parametry.

Nie ma jeszcze pełnego audytu historycznych portfeli, rozpoznawania powiązanych właścicieli/sybili, kompletnego dekodera strumieni swapów wszystkich DEX ani niezależnego eksperymentu rentowności. Obserwowani unikalni uczestnicy nie oznaczają dowiedzionych niezależnych osób.

## Uruchomienie — dla agenta wdrażającego

Wymagany Node 24, npm i dostęp HTTPS/WSS. Używać istniejącego checkoutu tej gałęzi; bez tworzenia worktree. Nie zatrzymywać ani nie nadpisywać innych usług użytkownika.

```sh
npm ci
npm run check
npm test
npm run build
npm run probe
```

Konfiguracja lokalna to `.env` utworzony z `.env.example`. Nie należy nadpisywać istniejącego `.env`. `npm start` działa domyślnie w observe; ten tryb nie podpisuje transakcji. NPM używa integralności z `package-lock.json`. Nie wyłączać TLS ani kontroli integralności przy instalacji.

W środowiskach z proxy `--use-env-proxy` obsługuje HTTP, a WebSocket używa `HTTPS_PROXY`/`HTTP_PROXY`. Nie logować ich wartości. `RPC_URL` i `RPC_WS_URL` powinny pochodzić od tego samego dostawcy/sieci. Publiczny RPC podczas testów dawał rzeczywiste odpowiedzi i strumień, ale też 429 — nie gwarantuje opóźnień/ciągłości wymaganych do snipingu.

`MODE=paper` korzysta z rzeczywistych kwotowań, ale rozliczenie jest symulowane po minOut i estymowanych kosztach. Wymaga nowego DATA_DIR. Nie odtwarza MEV, rzeczywistego lądowania, rewertów ani wpływu własnych transakcji na rynek. To nie jest backtest ani rzeczywisty zysk.

## Kontener i panel

`compose.yaml` tworzy osobny projekt Compose i wolumen `engine-data`. Nie dodaje bota do istniejących kontenerów. Panel jest mapowany wyłącznie na loopback hosta. Ponieważ w kontenerze słucha na `0.0.0.0`, wymagany jest losowy `DASHBOARD_TOKEN` o długości co najmniej 24 znaków. Nie publikować portu bez HTTPS i uwierzytelnienia istniejącego reverse proxy.

Kontener uruchamia się jako użytkownik `node`, bez capabilities, z systemem plików read-only poza `/app/data` i `/tmp`. Ścieżka portu aplikacji wewnątrz kontenera to 8787; przy zmianie portu hosta zachować ten port po stronie kontenera.

LIVE wymaga pliku keypair JSON zamontowanego tylko do odczytu poza repozytorium, jawnego `MODE=live`, `LIVE_ACK=I_ACCEPT_LIMITED_LIVE`, dodatniego `LIVE_FUNDING_CAP_USD`, limitów ekspozycji i SOL na wyjścia. Domyślny compose **nie montuje klucza**. Nie włączać LIVE wyłącznie na podstawie obecnych testów; otwarte braki walidacji i zależności są opisane w VALIDATION.

## Dokumentacja

- [SPECIFICATION.md](SPECIFICATION.md): wymagania użytkownika, bez wcześniejszego kodu.
- [VALIDATION.md](VALIDATION.md): wykonane i niewykonane sprawdzenia oraz pozostałe blokady.
- [CLAUDE.md](CLAUDE.md): stan i konkretne następne zadania dla Claude na VPS.
- [docs/SOURCES.md](docs/SOURCES.md): źródła dokumentacji i limity.

Nie ma wywołania LLM na krytycznej ścieżce sygnału lub transakcji. Claude służy do pracy nad kodem, eksperymentów i obsługi projektu.

W chmurze build online natrafił na problem z zaufaniem CA proxy. TLS pozostawiono włączony. Obraz sprawdzono przez `Dockerfile.cached` z nazwanym kontekstem `npm_cache`, po `npm cache verify`; `npm ci --offline` nadal weryfikuje integralność lockfile. Standardowy Dockerfile obsługuje opcjonalny publiczny CA bundle przez BuildKit secret `cloud_ca`, bez kopiowania go do obrazu runtime. To szczegół środowiska chmurowego, nie potrzeba dodatkowego sekretu portfela.
