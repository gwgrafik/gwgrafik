# MASTER PROMPT — SOLANA PROFIT ENGINE V1

## ROLA I GŁÓWNY CEL

Jesteś autonomicznym zespołem senior developerów specjalizujących się w Solana, tradingu algorytmicznym, analizie danych on-chain, systemach transakcyjnych o niskich opóźnieniach i zarządzaniu ryzykiem.

**ZADANIE: STWÓRZ OD ZERA KOMPLETNEGO, DZIAŁAJĄCEGO BOTA TRADINGOWEGO NA SOLANIE.**

Nie chcę projektu koncepcyjnego, kolejnego raportu, skanera bez możliwości kupowania ani kodu, który tylko przechodzi testy jednostkowe.

Chcę kompletnego systemu, który automatycznie:

1. Wykrywa nowe tokeny na Solanie możliwie wcześnie.
2. Wyszukuje tokeny, których ceny właśnie zaczynają mocno rosnąć.
3. Wykrywa tokeny już widoczne jako top gainers i trending.
4. Analizuje rzeczywistą aktywność kupujących i sprzedających.
5. Kupuje wybrane tokeny za około 2 USD na pozycję.
6. Weryfikuje po zakupie, czy wzrost rzeczywiście trwa.
7. Szybko sprzedaje tokeny tracące momentum, spadające lub pozostające bez aktywności.
8. Pozwala mocno rosnącym pozycjom dalej zarabiać.
9. Po znaczącym wzroście odzyskuje z danej pozycji początkowe 2 USD wraz z kosztami.
10. Pozostałe tokeny sprzedaje stopniowo na kolejnych wzrostach, pozostawiając część na wyjątkowo duży ruch.
11. Odzyskany kapitał wykorzystuje ponownie do kolejnych transakcji, z uwzględnieniem limitów ryzyka.
12. Prowadzi dokładną ewidencję faktycznie osiągniętego zysku netto.

**Priorytet: dodatnia, mierzalna rentowność netto, a nie liczba wykonanych transakcji.**

Nie zakładaj, że można zagwarantować zysk. Strategia ma być testowalna i oparta na danych, a nie na obietnicach.

---

## 1. NOWY PROJEKT — BEZ STAREGO KODU

Zaczynamy od zera.

Bezwzględne wymagania:

- Nie kopiuj kodu ze starych wersji V2, V3, V4 ani wcześniejszych botów.
- Nie korzystaj z ich algorytmów jako podstawy projektu.
- Nie przepisuj starej architektury.
- Nie traktuj wcześniejszych wyników symulacji jako dowodu skuteczności nowej strategii.
- Nie wykonuj kosmetycznej przebudowy starego projektu.
- Stwórz nowy katalog, nową strukturę, niezależny silnik i osobną bazę danych.
- Nie usuwaj ani nie zatrzymuj istniejących kontenerów, usług i botów na VPS.
- Możesz zbadać środowisko VPS pod kątem konfiguracji, zasobów, portów i bezpieczeństwa, ale nie przejmuj starej logiki handlowej.

Wykorzystuj aktualne, dobrze utrzymywane biblioteki i oficjalne SDK. Nie pisz własnych implementacji skomplikowanych protokołów tam, gdzie są dostępne sprawdzone rozwiązania.

---

## 2. RYNEK I ŹRÓDŁA TOKENÓW

Główny rynek: **Solana, nowe tokeny i memecoiny**.

Bot ma wyszukiwać okazje z kilku niezależnych kanałów.

### Kanały odkrywania

- Pump.fun — nowe tokeny, bonding curve, aktywność transakcyjna.
- PumpSwap — tokeny i handel po migracji.
- DexScreener — top gainers, trending, rosnące pule, aktywność.
- GeckoTerminal / CoinGecko — nowe i popularne pule, zmiany wolumenu i ceny.
- Raydium, Meteora i inne istotne DEX-y Solany.
- Dane bezpośrednio z blockchaina przez Solana RPC WebSocket.
- Aktywność wybranych, zweryfikowanych portfeli traderów, jeżeli można ją uzyskać wiarygodnie i zgodnie z warunkami dostawcy.

Nie ograniczaj bota wyłącznie do nowych emisji.

Jeżeli token istnieje już 20 minut, godzinę czy dłużej, ale nadal wyraźnie przyspiesza, bot również ma umieć go wykryć.

Jeżeli token jest już popularny na portalu i dalej rośnie, system nie może go automatycznie ignorować wyłącznie z powodu wieku lub wcześniejszego wzrostu.

### Kluczowe wymaganie

Nie wystarczy pobierać raz na minutę rankingu popularnych tokenów.

Wykorzystaj aktualnie dostępne strumienie on-chain i WebSocket tam, gdzie zapewniają przewagę czasową. Dane z agregatorów mają uzupełniać detekcję.

Rejestruj czas wykrycia zdarzenia, czas otrzymania danych, czas sygnału, czas wysłania transakcji i czas potwierdzenia.

Nie deklaruj reakcji w sekundę, jeśli infrastruktura lub źródło danych tego nie zapewnia.

---

## 3. KILKA STRATEGII W JEDNYM SILNIKU

Nie buduj jednego prymitywnego algorytmu.

Stwórz niezależne moduły strategii, ale ze wspólnym systemem zarządzania pozycjami i kapitałem.

### A. LAUNCH SNIPER

Wykrywanie świeżo uruchomionych tokenów.

Analiza pierwszych realnych zakupów, aktywności portfeli, płynności, kierunku ceny i struktury transakcji.

Kupuj, gdy istnieją wiarygodne oznaki rozpoczynającego się zainteresowania.

Nie kupuj każdego tokena natychmiast po utworzeniu.

### B. EARLY BREAKOUT

Wyszukiwanie tokenów, które przez krótki czas budują bazę, a następnie zaczynają dynamiczny wzrost.

Uwzględnij:

- przyspieszenie ceny,
- rosnący wolumen zakupów,
- zmianę przewagi kupujących nad sprzedającymi,
- liczbę niezależnych kupujących,
- utrzymywanie wybicia zamiast pojedynczego skoku.

### C. MOMENTUM / TREND FOLLOWING

Kupowanie tokenów, które już rosną, ale wykazują oznaki kontynuacji.

To jedna z najważniejszych strategii.

Nie chcę bota, który obserwuje spektakularne wzrosty i nigdy w nich nie uczestniczy.

Analizuj krótkie okna czasowe, dynamikę wzrostu, utrzymywanie lokalnych szczytów i jakość wolumenu.

Nie kupuj ślepo po jednorazowej zielonej świecy. Szukaj potwierdzenia kontynuacji.

### D. TOP GAINERS / LATE RUNNERS

Osobny moduł dla tokenów widocznych jako najszybciej rosnące na portalach.

Nie odrzucaj ich automatycznie dlatego, że wzrosły już o 100%, 300% czy więcej.

Sprawdzaj, czy nadal występuje prawdziwy popyt i czy wejście po kosztach ma sens.

Jeżeli token jest już w fazie gwałtownego zrzutu, nie kupuj go tylko dlatego, że nadal jest wysoko w rankingu.

### E. PULLBACK / RE-ENTRY

Wykrywanie krótkich korekt w silnym trendzie wzrostowym.

Kupowanie przy potwierdzonym powrocie popytu.

Rozróżniaj zdrową korektę od początku załamania.

### F. SCALPING

Szybkie transakcje na krótkich ruchach cenowych.

Nie stosuj scalpingu, jeżeli prowizje, spread, poślizg i koszt realizacji zjadają oczekiwaną przewagę.

### G. POST-MIGRATION

Wykrywanie tokenów migrujących z bonding curve na pule DEX.

Analizuj zachowanie płynności i ceny przed migracją, podczas migracji i po niej.

Nie zakładaj, że migracja oznacza automatyczny wzrost.

### H. SMART WALLET FOLLOWING

Opcjonalny moduł obserwowania rzeczywiście skutecznych portfeli.

Nie kopiuj transakcji tylko dlatego, że portfel jest popularny.

Weryfikuj zrealizowane wyniki, wielkość transakcji, powtarzalność i możliwość wykonania podobnego wejścia po aktualnej cenie.

Wszystkie strategie mają móc działać równocześnie bez dublowania zakupów tego samego tokena.

---

## 4. SILNIK WYBORU TOKENÓW

To najważniejsza część całego projektu.

Nie chcę kupowania przypadkowych memecoinów.

Zbuduj system oceny tokenów, który uwzględnia:

- aktualne tempo wzrostu ceny,
- przyspieszenie lub osłabienie momentum,
- liczbę i wartość rzeczywistych zakupów,
- wartość i tempo sprzedaży,
- przewagę popytu nad podażą,
- unikalnych uczestników rynku,
- dynamikę wolumenu,
- głębokość i jakość płynności,
- wielkość i koncentrację portfeli,
- nietypowe transfery dewelopera i dużych posiadaczy,
- wiek tokena oraz fazę jego życia,
- aktualną możliwość zakupu i sprzedaży,
- rzeczywistą cenę uzyskiwaną z kwotowania transakcji.

Nie opieraj decyzji wyłącznie na procentowym wzroście pokazywanym przez portal.

Wykrywaj sztuczny wolumen, manipulacje, transakcje powiązanych portfeli i krótkotrwałe pompowanie ceny, na tyle, na ile pozwalają wiarygodne dane.

Nie używaj dziesiątek sztywnych filtrów, które ostatecznie wykluczą wszystkie okazje.

Stosuj:

1. Twarde blokady dotyczące krytycznego bezpieczeństwa lub braku możliwości wykonania transakcji.
2. Dynamiczny scoring pozostałych kandydatów.
3. Decyzję opartą na jakości okazji, kosztach oraz aktualnym budżecie.

Każdy odrzucony token ma mieć zapisany konkretny powód odrzucenia.

Chcę później widzieć, dlaczego bot nie kupił tokena, który urósł przykładowo o 500%.

---

## 5. ZAKUPY — MAŁY KAPITAŁ, WIELE OKAZJI

Początkowa kwota zakupu:

**2 USD na pojedynczą pozycję.**

Wymagania:

- Równoczesne monitorowanie wielu tokenów.
- Możliwość posiadania kilku pozycji jednocześnie.
- Dynamiczna liczba pozycji zależna od dostępnego kapitału.
- Brak wielokrotnego kupowania tego samego tokena przez różne strategie bez świadomej decyzji silnika.
- Niewykorzystywanie środków potrzebnych do opłacenia sprzedaży.
- Automatyczne ponowne używanie kapitału odzyskanego z zamkniętych lub częściowo zamkniętych transakcji.

Zakup ma nastąpić, gdy token spełnia kryteria wejścia i transakcja ma ekonomiczny sens.

Nie kupuj tylko po to, żeby bot wykazywał aktywność.

Jeśli wejście za 2 USD jest nieopłacalne z uwagi na koszty, nie wykonuj go i zapisz dokładną przyczynę.

Wszystkie wartości USD przeliczaj na bieżąco. Nie zakładaj stałego kursu SOL.

---

## 6. NATYCHMIASTOWA OCENA PO ZAKUPIE

Po zakupie bot nie ma biernie czekać na przypadkowy wzrost.

Każda otwarta pozycja ma być aktywnie monitorowana.

Jeżeli:

- wzrost natychmiast zanika,
- presja sprzedażowa gwałtownie rośnie,
- token zaczyna spadać,
- brakuje nowych kupujących,
- cena pozostaje w miejscu zbyt długo,
- popyt słabnie przy pogarszającej się płynności,

system ma podejmować decyzję o szybkim wyjściu.

Czas bezczynności musi być zależny od strategii i danych. Dla części nowych memecoinów może być liczony w dziesiątkach sekund, dla innych dłużej.

Nie stosuj jednej sztywnej granicy czasowej dla wszystkich strategii.

Nie chcę zamrożonego kapitału w tokenach, które przestały wykazywać potencjał.

Jednocześnie nie sprzedawaj zdrowego trendu wyłącznie z powodu niewielkiej, normalnej korekty.

Wszystkie stop-lossy mają być weryfikowane na podstawie możliwej do wykonania ceny sprzedaży, a nie jedynie ceny prezentowanej przez agregator.

---

## 7. REALIZACJA ZYSKÓW — NAJWAŻNIEJSZY MECHANIZM

**NIE SPRZEDAWAJ CAŁEGO TOKENA TYLKO DLATEGO, ŻE OSIĄGNĄŁ NIEWIELKI ZYSK.**

Chcę uczestniczyć również w bardzo dużych wzrostach.

Przykład działania:

Kupuję token za 2 USD.

### ETAP 1 — ROZWÓJ POZYCJI

Pozycja rośnie do 3, 4, 5 USD.

Jeśli trend jest nadal mocny, nie zamykaj jej automatycznie tylko po to, żeby odzyskać wkład.

Chcę pozostawić miejsce na duży wzrost.

System może wcześniej wyjść, jeśli wykryje wyraźne pogorszenie sytuacji.

### ETAP 2 — ODZYSKANIE WKŁADU

Przykładowo po osiągnięciu wartości pozycji około 6 USD (3x od pierwotnego wkładu) wykonaj częściową sprzedaż.

Sprzedaj **tylko tyle tokenów, aby rzeczywiście odzyskać pierwotne 2 USD oraz przypisane koszty transakcyjne**.

Nie sprzedawaj automatycznie połowy pozycji.

Oblicz liczbę sprzedawanych tokenów na podstawie aktualnej wykonalnej kwoty otrzymanej po wszystkich kosztach.

Próg 3x jest początkowym, konfigurowalnym założeniem, które należy weryfikować na danych.

### ETAP 3 — POZOSTAŁE TOKENY DALEJ PRACUJĄ

Po odzyskaniu wkładu pozostała część pozycji uczestniczy w kolejnych wzrostach.

Przykładowa konfigurowalna drabinka:

- Przy 5x — sprzedaj 20% aktualnie pozostałych tokenów.
- Przy 10x — sprzedaj kolejne 20% aktualnie pozostałych tokenów.
- Przy dalszych wzrostach — realizuj dodatkowe części na podstawie dynamiki trendu.
- Resztę prowadź trailing stopem dostosowanym do zmienności.

Nie traktuj powyższych wielokrotności jako udowodnionej optymalnej strategii. Mają być parametrami startowymi.

Nie wolno zaprojektować algorytmu tak, żeby zawsze sprzedawał całość, zanim pojawi się potencjalny wzrost 10x, 20x czy większy.

### ETAP 4 — OCHRONA WYPRACOWANEGO ZYSKU

Wprowadź mechanizmy:

- dynamiczny trailing stop,
- ochronę zysków przy nagłym załamaniu,
- reakcję na nagły wzrost sprzedaży,
- stopniową realizację przy osłabieniu momentum,
- awaryjne zamknięcie pozycji, gdy dalsze utrzymywanie jest nieuzasadnione.

Jeśli pozycja osiągnęła wartość 7 USD z zakupu za 2 USD, a próg odzyskania wkładu wynosi 3x, system powinien mieć już wykonaną lub aktywnie obsługiwaną odpowiednią sprzedaż.

Nie akceptuję sytuacji, w której pozycja wielokrotnie osiąga próg realizacji zysku, ale bot nie sprzedaje z powodu błędnej logiki trailing stopa.

**Sprzedaż progowa i trailing stop muszą być niezależnymi, prawidłowo współpracującymi mechanizmami.**

Nie można oznaczyć kapitału jako odzyskanego przed potwierdzeniem transakcji.

---

## 8. OBSŁUGA SPRZEDAŻY I RZECZYWISTYCH WYPŁAT

W tym projekcie „wypłata” oznacza sprzedaż części tokena i zwrot uzyskanych środków do płynnego salda portfela w SOL lub USDC, zgodnie z konfiguracją.

Nie oznacza automatycznego transferu na zewnętrzny portfel ani wypłaty na konto bankowe.

Bot musi:

- obsługiwać sprzedaż procentową,
- obsługiwać sprzedaż odpowiadającą określonej kwocie USD netto,
- liczyć dostępne tokeny z uwzględnieniem decimals,
- nie sprzedawać więcej niż faktycznie posiada,
- potwierdzać wykonanie na blockchainie,
- rozliczać rzeczywiście otrzymane środki,
- obsługiwać częściowe i nieudane wykonania,
- bezpiecznie ponawiać transakcje bez przypadkowej podwójnej sprzedaży,
- odświeżać saldo i stan pozycji po każdej transakcji.

Uwzględnij oddzielnie koszt zakupu, koszt sprzedaży, opłaty DEX/protokołu, opłaty sieciowe, priority fees i poślizg.

---

## 9. TECHNOLOGIA I EXECUTION ENGINE

Preferowana technologia:

- TypeScript / Node.js,
- oficjalne SDK Solany,
- aktualne oficjalne SDK Pump.fun i PumpSwap,
- aktualne Jupiter Swap API,
- WebSocket i RPC,
- Docker,
- trwała baza danych transakcji,
- prosty interfejs monitorowania.

Możesz dobrać inne komponenty, jeżeli istnieje konkretne techniczne uzasadnienie.

W pierwszej kolejności sprawdź aktualną dokumentację dostawców.

Źródła techniczne:

- https://github.com/pump-fun/pump-public-docs
- https://developers.jup.ag/docs/swap
- https://docs.dexscreener.com/api/reference
- https://solana.com/docs
- https://www.coingecko.com/en/api

Zweryfikuj obecnie dostępne endpointy i limity. Nie kopiuj nieaktualnych przykładów dotyczących starych wersji swap API.

System wykonawczy powinien wspierać zarówno odpowiednie transakcje na bonding curve, jak i w pulach DEX, jeżeli dany mechanizm jest faktycznie obsługiwany.

Zaprojektuj oddzielne adaptery źródeł danych i wykonania zleceń.

Dane nie mogą być tak opóźnione, żeby bot kupował dopiero po zakończeniu wzrostu.

Nie stosuj automatycznie ogromnego slippage w celu wymuszenia każdej transakcji.

Przy niedostępności jednego źródła danych silnik powinien umieć korzystać z innego wiarygodnego źródła, ale nie może wykonywać zakupów na podstawie nieaktualnych lub sprzecznych informacji.

---

## 10. BEZPIECZEŃSTWO I KONTROLA PORTFELA

Bot będzie pracował z prawdziwymi środkami.

Zadbaj o:

- dedykowany portfel handlowy z ograniczonym saldem,
- przechowywanie sekretów poza kodem i repozytorium,
- brak logowania kluczy prywatnych i seed phrase,
- brak możliwości nieautoryzowanego transferowania środków,
- kontrolę łącznego zaangażowania kapitału,
- limity ryzyka konfigurowane z jednego miejsca,
- sprawdzanie możliwości sprzedaży tokenów przed wejściem, w zakresie dostępnych metod,
- analizę mint authority, freeze authority i właściwych rozszerzeń Token-2022,
- wykrywanie istotnych zagrożeń wynikających z koncentracji podaży i płynności,
- ochronę przed wielokrotnym wykonaniem tego samego zlecenia.

Nie traktuj pozytywnej kontroli bezpieczeństwa jako gwarancji braku rug pulla.

Awaria źródła danych powinna wstrzymywać nowe zakupy oparte na tym źródle, ale moduł obsługi otwartych pozycji powinien nadal próbować działać poprzez dostępne, wiarygodne kanały.

Przy utracie możliwości skutecznej sprzedaży wyświetl alarm krytyczny.

---

## 11. DASHBOARD — CHCĘ WIDZIEĆ CO BOT ROBI

Przygotuj prosty panel WWW dostępny po zabezpieczonym połączeniu.

Chcę widzieć na żywo:

**GŁÓWNY EKRAN**

- Dostępne środki.
- Kapitał zaangażowany.
- Liczbę otwartych pozycji.
- Wartość każdej pozycji według wykonalnej ceny sprzedaży.
- Faktycznie zrealizowany zysk lub stratę netto.
- Aktualny niezrealizowany PnL, osobno od zrealizowanego.
- Łączne koszty handlu.
- Wynik każdej strategii.
- Stan połączenia z RPC, DEX i innymi źródłami.

**TOKENY**

Dla każdego obserwowanego tokena:

- nazwa i mint address,
- link do wykresu i eksploratora,
- źródło wykrycia,
- aktualny wzrost,
- scoring,
- decyzja BUY / WATCH / REJECT,
- konkretny powód podjętej decyzji.

**POZYCJE**

Dla każdej pozycji:

- cena i czas rzeczywistego zakupu,
- aktualna cena możliwej sprzedaży,
- najwyższa wykryta wykonalna wartość pozycji,
- próg stop-loss,
- próg odzyskania wkładu,
- wykonane sprzedaże częściowe,
- pozostała liczba tokenów,
- wynik netto po kosztach.

Dodaj historię wszystkich transakcji wraz z hashami i statusami potwierdzenia.

---

## 12. WYMAGANE TESTY

Nie uznaję działania aplikacji za dowód, że strategia działa.

Testy muszą obejmować logikę finansową, dane rynkowe, transakcje i zachowanie systemu.

Obowiązkowe scenariusze:

**Test 1:** Kupno za 2 USD, wzrost do 6 USD. Bot prawidłowo odzyskuje wkład i odpowiednie koszty, pozostawiając resztę tokenów.

**Test 2:** Kupno za 2 USD, wzrost do 7 USD. Bot nie może przegapić wcześniej ustalonego progu realizacji zysku.

**Test 3:** Kupno za 2 USD, szybki spadek. Bot generuje sygnał wyjścia i prawidłowo obsługuje sprzedaż lub raportuje faktyczną przeszkodę.

**Test 4:** Kupno za 2 USD, brak aktywności. Bot usuwa nieperspektywiczną pozycję według parametrów strategii.

**Test 5:** Token rośnie 10x i 20x. Bot realizuje odpowiednie części zysku i zachowuje kontrolowaną pozycję pozwalającą uczestniczyć w dalszym ruchu.

**Test 6:** Dwie strategie wykrywają ten sam token. Nie dochodzi do niezamierzonego podwójnego zakupu.

**Test 7:** Transakcja sprzedaży kończy się timeoutem. Bot sprawdza rzeczywisty stan blockchaina przed ponowieniem.

**Test 8:** Restart VPS podczas otwartej pozycji. Po wznowieniu wszystkie salda i pozycje są odtwarzane oraz uzgadniane z blockchainem.

**Test 9:** Wysoki slippage i koszt wykonania. Bot nie raportuje fikcyjnego zysku.

**Test 10:** Token trafia do top gainers. System rejestruje wykrycie, ocenę i uzasadnienie wejścia lub odrzucenia.

**Test 11:** Token migruje między mechanizmami handlu. Bot nie gubi pozycji i poprawnie identyfikuje aktualną drogę sprzedaży.

**Test 12:** Token ma pozorną cenę, ale brakuje rzeczywistej możliwości sprzedaży. System nie przedstawia tej ceny jako możliwej do odzyskania gotówki.

Stosuj testy jednostkowe, integracyjne, replay danych rynkowych i testy awaryjne.

Backtest musi respektować chronologię danych i nie może wykorzystywać informacji, które nie były znane w momencie decyzji.

Uwzględnij opóźnienia, prowizje, poślizg i rzeczywistą wykonalność zleceń.

---

## 13. VPS I WDROŻENIE

Środowisko VPS jest już dostępne i skonfigurowane do pracy w chmurze.

Zbadaj rzeczywistą konfigurację, zanim dobierzesz sposób uruchomienia.

Twoje zadanie:

1. Stwórz całkowicie nowy projekt.
2. Przygotuj pełny kod źródłowy.
3. Skonfiguruj wszystkie potrzebne usługi.
4. Zbuduj kontenery.
5. Utwórz trwały magazyn danych.
6. Sprawdź komunikację z Solaną i dostawcami danych.
7. Uruchom detekcję tokenów w czasie rzeczywistym.
8. Przetestuj realizację kupna i sprzedaży.
9. Zweryfikuj obliczenia kapitału i pozycji.
10. Przygotuj bezpieczny, ograniczony start LIVE.

Najpierw uruchom szybkie, rzeczywiste testy połączeń i mechanizmu transakcyjnego. Nie rozciągaj tego na niekończące się symulacje.

Przejście na handel prawdziwymi środkami ma być kontrolowane przez jawny tryb LIVE i uprzednio skonfigurowany limit finansowania. Nie wolno uruchamiać nieograniczonego handlu.

Nie nadpisuj istniejących usług ani sekretów.

Bot ma pracować samodzielnie 24/7, ze wznowieniem po restarcie.

---

## 14. POMIAR SKUTECZNOŚCI

Chcę wiedzieć, czy nowy silnik rzeczywiście znajduje dobre okazje.

Mierz:

- liczbę wykrytych tokenów,
- liczbę ocenionych okazji,
- liczbę zakupów,
- udział rentownych zamkniętych pozycji,
- średnią wygraną i stratę,
- expectancy netto na transakcję,
- profit factor,
- maksymalne obsunięcie kapitału,
- koszty w relacji do wielkości pozycji,
- skuteczność poszczególnych strategii,
- medianę opóźnienia od wykrycia sygnału do zakupu,
- różnicę między ceną sygnału a realnym wykonaniem,
- liczbę przegapionych okazji i przyczyny.

Przechowuj też wyniki tokenów, których bot nie kupił, aby można było ocenić, czy filtry odrzucają największych zwycięzców.

Rozdzielaj wyniki backtestu, paper tradingu i rzeczywistego LIVE.

Nie twierdź, że strategia jest zyskowna, dopóki nie ma na to wystarczających danych netto.

Nie optymalizuj strategii wyłącznie pod pojedynczy krótki okres historyczny.

---

## 15. PRIORYTETY WYKONANIA

Nie chcę rozbudowanego projektu, w którym powstaje ogromny dashboard, ale nadal nie ma działającego systemu kupna i sprzedaży.

Kolejność prac:

**PRIORYTET 1 — DISCOVERY**

Rzeczywiste, możliwie szybkie wykrywanie nowych i rosnących tokenów.

**PRIORYTET 2 — SELECTION**

Wybieranie najlepszych okazji zamiast przypadkowych zakupów.

**PRIORYTET 3 — EXECUTION**

Niezawodny zakup i sprzedaż, weryfikacja potwierdzeń oraz uzgadnianie sald.

**PRIORYTET 4 — PROFIT MANAGEMENT**

Odzyskiwanie wkładu, częściowe realizacje, prowadzenie trendu, szybkie zamykanie słabych pozycji.

**PRIORYTET 5 — MONITORING I OPTYMALIZACJA**

Wyniki, analityka, dashboard i ulepszanie parametrów na podstawie rzeczywistych danych.

Nie zmieniaj tej kolejności na korzyść funkcji pobocznych.

---

## 16. ZASADY PRACY DLA CODEXA

Masz samodzielnie podejmować standardowe decyzje techniczne.

Nie zatrzymuj pracy na etapie przedstawienia koncepcji.

Nie pytaj mnie o wybór każdej biblioteki, struktury plików czy drobnego parametru.

Gdy brakuje zewnętrznego klucza lub dostępu, wykonaj wszystkie możliwe prace bez niego i jasno wskaż jedynie rzeczywistą blokadę. Nie wymyślaj danych dostępowych.

Korzystaj z aktualnej dokumentacji.

Nie twórz fikcyjnych wyników testów ani pozornych transakcji LIVE.

Nie oznaczaj funkcjonalności jako gotowej, jeśli nie została zweryfikowana.

Nie próbuj naprawiać problemów poprzez bezrefleksyjne podnoszenie slippage lub wyłączanie zabezpieczeń.

Nie wprowadzaj płatnych API, dopóki nie wykażesz, że darmowe rozwiązania nie wystarczają do wymaganego działania. Jeżeli darmowe źródło nie spełnia krytycznych wymagań opóźnienia lub niezawodności, przedstaw ten fakt jasno.

Kod musi być czytelny, modularny, testowalny i możliwy do dalszego rozwoju.

Po każdej zakończonej fazie wykonaj jej testy i przejdź do kolejnej, bez wielokrotnego pisania tych samych raportów.

---

## 17. KOŃCOWE KRYTERIA AKCEPTACJI

Uznaj projekt za ukończony technicznie dopiero wtedy, gdy:

- Bot działa jako osobny system na VPS.
- Odbiera prawdziwe dane rynkowe z Solany.
- Wykrywa nowe i już rosnące tokeny.
- Potrafi wskazać rzeczywistą przyczynę zakupu lub odrzucenia.
- Prawidłowo oblicza zakup za 2 USD.
- Potrafi złożyć, potwierdzić i rozliczyć rzeczywistą transakcję.
- Potrafi sprzedać całą pozycję i jej część.
- Mechanizm odzyskiwania wkładu przechodzi wymagane testy.
- Mechanizm stop-loss i wyjścia z nieaktywnych pozycji działa.
- Wszystkie pozycje przetrwają restart systemu.
- PnL jest liczony po kosztach i uzgadniany z portfelem.
- Nie występują niezamierzone duplikaty transakcji.
- Jest dostępny czytelny podgląd bieżącej pracy.
- Można włączyć ograniczony LIVE bez ponownego pisania silnika.

Nie uznawaj samego zaliczenia testów technicznych za dowód rentowności.

W końcowym raporcie podaj konkretnie:

1. Co zostało napisane i uruchomione.
2. Które źródła danych rzeczywiście działają.
3. Które strategie są aktywne.
4. Które scenariusze zostały przetestowane.
5. Czy wykonano i potwierdzono transakcje LIVE, czy wyłącznie testowe.
6. Jaki jest aktualny rzeczywisty wynik netto, jeżeli uruchomiono LIVE.
7. Co pozostaje niezweryfikowane lub stanowi blokadę.

**Ostateczne polecenie:**

Zbuduj całkowicie nowy, samodzielny, działający silnik tradingowy Solana, który automatycznie wykrywa wartościowe okazje, kupuje małymi kwotami, szybko usuwa słabe pozycje, odzyskuje początkowy kapitał po znaczącym wzroście i pozwala najlepszym pozycjom generować dalszy zysk.

Nie chcę kolejnej wersji starego bota. Chcę nowej implementacji, którą da się rzeczywiście przetestować na rynku, z pełną kontrolą kosztów i wyniku.

**ROZPOCZNIJ IMPLEMENTACJĘ.**
