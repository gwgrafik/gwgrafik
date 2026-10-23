# Sprawdzone źródła — 23.10.2026

- https://github.com/pump-fun/pump-public-docs — odczytano aktualne zmiany v3/PumpSwap v2, quote mints i fee. Pobrane pakiety npm: pump-sdk 4.3.1, pump-swap-sdk 2.2.0; są nowsze od wersji wskazanych w początkowym README. Kod korzysta z API faktycznie zainstalowanych paczek, przypiętych lockfile.
- https://developers.jup.ag/docs/swap — odczytana bieżąca dokumentacja: Swap API V2. V1 jest starszą integracją i nie jest używana przez nowy adapter.
- https://developers.jup.ag/docs/swap/build — raw instructions, kompilacja własnej transakcji i własne RPC. V2 `/build` nie dolicza swap fee Jupiter, opłaty DEX pozostają w kwotowaniu. Wybrano ten wariant ze względu na kontrolę kosztów, nadania i uzgadniania.
- https://api.jup.ag/swap/v2/order — potwierdzono publiczne kwotowanie bez klucza, bez taker i bez transakcji.
- https://api.jup.ag/swap/v2/build — potwierdzono instrukcje i lookup tables dla publicznego adresu testowego; niczego nie podpisano ani nie nadano.
- Według odczytanej dokumentacji Jupiter: keyless 0,5 RPS, bezpłatny klucz 1 RPS. Nie założono płatnego planu. Wyższa częstotliwość wymaga zmierzonej potrzeby i osobnej konfiguracji.
- https://docs.dexscreener.com/api/reference — strona dokumentacji odmawiała dostępu HTTP 403; faktycznie przetestowano API profiles/latest, boosts/top, token-pairs i tokens/v1. Nie wymyślono endpointu globalnego top gainers. Ograniczenia używanego API wymagają dalszego monitorowania w docelowym środowisku.
- https://api.geckoterminal.com/api/v2/networks/solana/new_pools i `/trending_pools` — odpowiedzi rzeczywiste potwierdzone. Źródła REST uzupełniają WebSocket.
- https://www.coingecko.com/en/api — dokumentacja odmawiała HTTP 403; nie deklarowano odrębnej integracji CoinGecko jako ukończonej.
- https://solana.com/docs — dokumentacja dostępna; RPC blockhash, transakcje, statusy, konta i WebSocket sprawdzone na publicznym mainnet RPC. Zdarzały się limity 429.

Dokumentacja może zmienić się po tej dacie. Nie wyłączano TLS, nie modyfikowano integralności paczek i nie deklarowano wykonania nieprzeprowadzonych swapów.
