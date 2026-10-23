# Dziennik pracy

## Poprawka po raporcie LIVE użytkownika

- Potwierdzono w kodzie nadmierne próby i traktowanie dwóch limitów slippage jako oczekiwanego kosztu.
- Dodano admission przed RPC, cache/single-flight sald i kont, unieważnianie po transakcjach, cooldown 429 z Retry-After i priorytet wyjść.
- Rozdzielono expectedOutUsd i chronione outUsd. Limit kosztu 5% i minOut nie zostały podniesione.
- Zaliczone 30/30 testów, build i typecheck; odczytano dwukrotnie rzeczywiste kwotowania V2 z limitem keyless 0,5 RPS. Nie podpisano transakcji ani nie zmieniono VPS.
- Nieopublikowane commity Claude z VPS wymagają udostępnienia treści i scalenia. Poprawka powstaje na osobnej gałęzi, bazującej na 6a059ea.

## 2026-10-23 — nowy projekt

- Utworzono odrębną implementację TypeScript zgodnie z nową specyfikacją użytkownika. Zachowano poprzednie repozytorium portfolio i wcześniejszy research.
- Zweryfikowano aktualne pakiety SDK i dokumentację. Po uzyskaniu dostępu do aktualnej dokumentacji zmigrowano adapter z planowanego V1 na Jupiter Swap V2 `/build`.
- Utworzono discovery, scoring, executor, SQLite, zarządzanie pozycją, panel, kontener i obserwację portfeli.
- Zaliczone 17 scenariuszy testowych; bez rzeczywistych swapów. Build i typecheck wykonano w chmurze.
- Odbiór danych na mainnet i WSS potwierdzono. Odkryte ograniczenie 429 doprowadziło do grupowania metadanych. Dalsza walidacja przepustowości pozostaje potrzebna.
- LIVE, rentowność, pełny replay i audyt portfeli nie są ukończone. Otwarte zadania są jawne w CLAUDE.md i VALIDATION.md.

- Dodatkowo: kontrola księgi z cash i kosztami rewertów, zwolnienie rezerwacji paper po restarcie, rolling 24h loss ledger oraz ograniczenie cache. 17/17 testów.
- Potwierdzono build kontenera z cache npm sprawdzonym pod kątem integralności, HTTP 200 i restart z zachowaniem bazy. Brak fills i brak portfela.
