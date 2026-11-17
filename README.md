# AI DATA HUB · CK Complex

Analityka sprzedaży z asystentem AI dla dyrekcji CK Complex: kierownicy, punkty sprzedaży, produkty, marże, mapa sieci, raporty. Asystent (DeepSeek) odpowiada wykresami 2D/3D, mapą, siecią 3D i raportami — wszystko animowane.

**Produkcja:** https://datahub.infinitiq.pl (GitHub Pages) · **Backend:** Supabase `qcmqiviwwhwzxsjmzxkl` (DATE HUB)

## Stack

| Warstwa | Technologia |
|---|---|
| Front | Svelte 5 + Vite + TypeScript (SPA, hash-routing, strony ładowane leniwie) |
| Style | Tailwind 4 + tokeny (`src/app.css`), akcenty per grupa danych |
| Wykresy | ECharts (modułowo) + echarts-gl (3D, leniwie) + Three.js (sieć 3D, leniwie) |
| Mapa | MapLibre GL + kafelki OpenFreeMap, przemalowane pod motyw |
| Pliki | SheetJS w Web Workerze |
| Backend | Supabase: Postgres + Auth + Edge Functions |
| AI | DeepSeek (`deepseek-chat`) przez edge function `ai` — klucz tylko w sekretach Supabase |

## Jak to działa

- **Każde źródło = tabela `ds.d_<id>`** opisana w `public.datasets` (kolumny, typy, role, metadane). Excel/CSV/JSON z przeglądarki, REST/POS API, plik z linku (Google Sheets), PostgreSQL, MySQL — wszystko trafia w ten sam format (`src/lib/data/infer.ts`, wspólny z edge functions).
- **Role kolumn** (kierownik, punkt, produkt, netto, brutto, marża…) wykrywane automatycznie, edytowalne w „Źródła danych". Dashboardy budują się z ról, więc działają dla dowolnego pliku. Kolumny pochodne: `zysk = netto × marża`, `cena_szt = netto / ilość`, `kategoria = pierwsze słowo nazwy`.
- **Uwaga:** w eksporcie CK `BRUTTO = NETTO × 1,23` (VAT). Zysk to `netto × marża`, a nie `brutto − netto`.
- **Słownik punktów** (`public.locations`): plik typu „CK_Sklepy_import" (kod, miasto, adres, oddział, rodzaj, e-mail). Adresy geokoduje przeglądarka (Nominatim/OSM, 1 zapytanie/s). Kody bez adresu rozkłada AI (edge `geo`).
- **Agregacje** po stronie bazy: `ds_agg`, `ds_hist`, `ds_rows` (bezpieczny SQL z białą listą kolumn), cache w pamięci przeglądarki.

### Oszczędzanie tokenów (edge `ai`)
1. Stały system-prompt + stabilna „karta" zbioru danych na początku → cache prefiksu DeepSeek (≈10× taniej).
2. Model dostaje schemat i statystyki kolumn, nie dane; pisze SQL, liczy Postgres.
3. Wyniki do modelu — skrócone CSV (≤ 40 wierszy), pełne — tylko do klienta.
4. Wykresy odwołują się do wyniku zapytania po id — model nie przepisuje liczb.
5. Historia rozmowy — tylko skrócone teksty ostatnich N wymian.
6. Pamięć identycznych pytań (unieważniana przy zmianie danych).

Parametry, cennik i zużycie: **Ustawienia**.

### Bezpieczeństwo
- Rejestracja wyłączona; konta tworzy się w Ustawieniach (login → wewnętrzny adres `<login>@datehub.infinitiq.pl` — to tylko identyfikator, maile nie są wysyłane; nie zmieniać razem z domeną).
- RLS na wszystkich tabelach; schemat `ds` niedostępny bezpośrednio.
- SQL od AI wykonuje funkcja `ai.run` jako rola `ai_reader` (tylko SELECT na `ds.*` i `locations`), tylko z edge function (service_role), jedna instrukcja, bez funkcji systemowych.
- Sekrety połączeń w `connector_secrets` (brak polityk RLS → tylko serwer).

## Rozwój

```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # svelte-check
npm run build
```

`.env` / `.env.production`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` (publishable — publiczny z definicji).

### Baza i funkcje
- Migracje: `supabase/migrations/*.sql` (stosowane przez Management API / SQL editor).
- Edge functions: `ai`, `users`, `geo`, `connect` — deploy:
  ```bash
  SUPABASE_ACCESS_TOKEN=sbp_… node scripts/deploy-functions.mjs        # wszystkie
  SUPABASE_ACCESS_TOKEN=sbp_… node scripts/deploy-functions.mjs ai     # jedna
  ```
- Sekrety funkcji: `DEEPSEEK_API_KEY` (ustawiony), opcjonalnie `CRON_SECRET` dla planowej synchronizacji połączeń.

## Deploy (GitHub Pages)

1. Repo → **Settings → Pages → Source: GitHub Actions**.
2. Push do `main` → workflow `.github/workflows/deploy.yml` buduje i publikuje `dist/`.
3. Domena: `public/CNAME` = `datahub.infinitiq.pl`. W DNS domeny `infinitiq.pl` dodaj **CNAME `datahub` → `damian-barabash.github.io`**, potem w Settings → Pages zaznacz „Enforce HTTPS".
