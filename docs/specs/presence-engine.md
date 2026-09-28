# Specyfikacja Techniczna: Personal Presence Engine (DFCMS Living Presence)

> **Status:** Draft / Wave 0 Architecture  
> **Data:** 2026-09-26  
> **Autorzy:** Architektura DFCMS, CTO, Product Lead  
> **Kontekst:** Ewolucja z tradycyjnego edytora CMS/AI Builder do autonomicznego silnika cyfrowej obecności (*Living Internet Presence*).

---

## 1. Wizja i Definicja Kategorii Produktowej

Tradycyjne narzędzia (WordPress, Webflow, Wix, Framer) traktują stronę internetową jak **cyfrową nieruchomość**, w której użytkownik musi nieustannie sprzątać, przekładać klocki i ręcznie wpisywać nowe treści.

**DFCMS Personal Presence Engine** odwraca ten wektor o 180 stopni:
* **Użytkownik:** zajmuje się swoją pracą i życiem (tworzy meble, piecze chleb, strzyże włosy, programuje, zbiera opinie od klientów).
* **DFCMS Presence Engine:** obserwuje dozwolone sygnały z narzędzi, których użytkownik już używa, rozumie co się wydarzyło i **proaktywnie aktualizuje jego cyfrową obecność**.

> **Główna obietnica produktu:**  
> *„Stop building your website. Just keep doing your work. Your presence takes care of itself.”*

---

## 2. Architektura 4 Warstw (The 4-Layer Engine)

```
                 UŻYTKOWNIK (Życie i Praca)
                             │
                             ▼
┌────────────────────────────────────────────────────────┐
│ 1. PERCEPTION LAYER (Kolektory Sygnałów)               │
│    • Public: Instagram, Google Business, LinkedIn      │
│    • Work: Google Drive (katalog projektów), GitHub   │
│    • Direct: Szybkie notatki audio/foto (WhatsApp bot) │
└────────────────────────────┬───────────────────────────┘
                             │  surowy strumień: presence_signals
                             ▼
┌────────────────────────────────────────────────────────┐
│ 2. DIGITAL TWIN & KNOWLEDGE GRAPH (Mózg & Pamięć)      │
│    • Kto to jest? Co robi? Co osiągnął?                │
│    • Korelacja faktów (np. foto z IG + opinia Google)  │
│    • Wewnętrzny graf wiedzy i ton komunikacji          │
└────────────────────────────┬───────────────────────────┘
                             │  zrozumiane fakty & dynamika
                             ▼
┌────────────────────────────────────────────────────────┐
│ 3. AUTONOMOUS CURATOR (Reżyser i Decydent)             │
│    • Co z tego ma wartość rynkową dla tej osoby?      │
│    • Tworzenie propozycji: presence_proposals          │
│    • Human-in-the-loop: 1-click zatwierdzenie / Undo   │
└────────────────────────────┬───────────────────────────┘
                             │  zatwierdzone zmiany (diff)
                             ▼
┌────────────────────────────────────────────────────────┐
│ 4. LIVING PROJECTION (Obecność w Internecie)           │
│    • Żywy Timeline / Ostatnie realizacje               │
│    • Dynamiczny Social Proof & Opinie powiązane z foto │
│    • Site Agent (obsługa zapytań i kwalifikacja)      │
└────────────────────────────────────────────────────────┘
```

---

## 3. Kontrakt Danych i Schematy (`js/core/`)

Zgodnie z zasadą **Anti-Monolith (Extract-First)** z `AGENTS.md`, cała logika domenowa żyje w czystych funkcjach bez zależności od DOM czy Alpine.js:

### 3.1 `digitalTwinSchema.js`
Definiuje strukturę modelu tożsamości oraz znormalizowanych sygnałów:

```typescript
interface DigitalTwinState {
  version: 1;
  identity: {
    businessName: string;
    category: string;
    city: string;
    toneOfVoice: string; // np. 'rzemieślniczy-minimalizm', 'profesjonalny-premium'
    tagline: string;
  };
  facts: {
    skills: string[];
    specializations: string[];
    pricingIndications?: string;
  };
  sources: {
    instagram?: { connected: boolean; username?: string; lastSync?: string };
    google_business?: { connected: boolean; placeId?: string; lastSync?: string };
    google_drive?: { connected: boolean; folderId?: string; lastSync?: string };
  };
  updated_at: string;
}
```

### 3.2 Zdarzenia: `presence_signals`
Każdy sygnał z zewnętrznego zmysłu ląduje w znormalizowanej postaci:
```typescript
interface PresenceSignal {
  id: string;
  page_id: string;
  user_id: string;
  source: 'instagram' | 'google_reviews' | 'google_business' | 'drive' | 'direct_note';
  scope: 'public' | 'work' | 'direct';
  external_id?: string;
  payload: {
    text?: string;
    media_urls?: string[];
    rating?: number;
    author_name?: string;
    timestamp?: string;
    metadata?: Record<string, unknown>;
  };
  created_at: string;
}
```

### 3.3 Propozycje: `presence_proposals`
Kurator AI nigdy nie nadpisuje publicznej strony "po cichu" bez zgody (wymóg **EU AI Act Art. 50 & Human-in-the-loop**):
```typescript
interface PresenceProposal {
  id: string;
  page_id: string;
  user_id: string;
  type: 'new_project_case_study' | 'review_spotlight' | 'hero_focus_shift' | 'timeline_update';
  title: string;
  summary: string;
  diff_patch: {
    target: 'blocks' | 'settings' | 'timeline';
    operation: 'append' | 'replace' | 'reorder';
    data: Record<string, unknown>;
  };
  evidence_signal_ids: string[];
  status: 'pending' | 'applied' | 'rejected' | 'superseded';
  created_at: string;
  applied_at?: string;
}
```

---

## 4. Bezpieczeństwo, RODO i EU AI Act

```
[Audyt Soczewek]:
1. 🏛️ Anti-Monolith   -> Czyste reguły w js/core/presenceRules.js + digitalTwinSchema.js
2. 🛡️ Security Lens    -> RLS: signals & proposals dostępne TYLKO dla właściciela strony (auth.uid() = user_id).
                          Klucze OAuth/API trzymane w Supabase Vault.
                          Ochrona przed Prototype Pollution (__proto__, constructor).
3. 🇪🇺 EU AI Act Lens   -> Art. 50: Użytkownik widzi, dlaczego AI proponuje zmianę (podpięte dowody w evidence_signal_ids).
                          Human-in-the-loop: 1-click decyzja (Zatwierdź / Odrzuć / Cofnij).
                          Zakaz manipulacji: AI nie fabrykuje ocen ani nie zmyśla opinii.
4. 🔒 RODO Lens        -> Minimalizacja danych (Art. 5): stripowanie danych wrażliwych przed zapisaniem sygnału.
                          Prawa podmiotu danych: usunięcie konta usuwa cały Digital Twin i sygnały.
```

---

## 5. Fazy Wdrożenia (Roadmapa)

1. **Fala 0 (Architektura & Schematy)**:
   - Specyfikacja, `digitalTwinSchema.js`, `presenceRules.js`, migracja DB dla `presence_signals` i `presence_proposals`, testy jednostkowe.
2. **Fala 1 (The First "Wow" MVP — 2 Źródła)**:
   - Polling / Webhook nowych opinii Google Places.
   - Szybki import realizacji (Upload/Instagram Drop).
   - Generowanie propozycji dodania realizacji z powiązaną opinią.
   - UI w panelu: minimalistyczny kafelek *„Twoja obecność żyje. 1 nowa rzecz czeka na zatwierdzenie”*.
3. **Fala 2 (Żywy Timeline & Multimodalna Korelacja)**:
   - Komponent `timeline` na szablonach.
   - Analiza zdjęć (Gemini Flash Vision) i korelacja faktów.
4. **Fala 3 (Site Agent)**:
   - Interaktywny asystent dla odwiedzających witrynę odpowiadający na podstawie Digital Twin.
