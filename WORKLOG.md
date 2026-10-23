# Dziennik pracy

## 2026-10-23 — nowy projekt

- Utworzono odrębną implementację TypeScript zgodnie z nową specyfikacją użytkownika. Zachowano poprzednie repozytorium portfolio i wcześniejszy research.
- Zweryfikowano aktualne pakiety SDK i dokumentację. Po uzyskaniu dostępu do aktualnej dokumentacji zmigrowano adapter z planowanego V1 na Jupiter Swap V2 `/build`.
- Utworzono discovery, scoring, executor, SQLite, zarządzanie pozycją, panel, kontener i obserwację portfeli.
- Zaliczone 17 scenariuszy testowych; bez rzeczywistych swapów. Build i typecheck wykonano w chmurze.
- Odbiór danych na mainnet i WSS potwierdzono. Odkryte ograniczenie 429 doprowadziło do grupowania metadanych. Dalsza walidacja przepustowości pozostaje potrzebna.
- LIVE, rentowność, pełny replay i audyt portfeli nie są ukończone. Otwarte zadania są jawne w CLAUDE.md i VALIDATION.md.

- Dodatkowo: kontrola księgi z cash i kosztami rewertów, zwolnienie rezerwacji paper po restarcie, rolling 24h loss ledger oraz ograniczenie cache. 17/17 testów.
- Potwierdzono build kontenera z cache npm sprawdzonym pod kątem integralności, HTTP 200 i restart z zachowaniem bazy. Brak fills i brak portfela.
