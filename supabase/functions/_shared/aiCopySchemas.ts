/**
 * SoT pól copy dla AI Site Generator (mirror kształtu js/templates/registry.js).
 * Przy nowym motywie: registry + publishedThemes + ten plik.
 */

export type FieldDef =
  | "string"
  | { type: "object"; fields: Record<string, FieldDef> }
  | { type: "array"; item: Record<string, FieldDef>; maxItems?: number }
  | { type: "stringArray"; maxItems?: number };

const FAQ_ITEM: Record<string, FieldDef> = {
  question: "string",
  answer: "string",
};

const SERVICE_BASIC: Record<string, FieldDef> = {
  title: "string",
  desc: "string",
};

const SERVICE_PRICED: Record<string, FieldDef> = {
  title: "string",
  desc: "string",
  details: "string",
  duration: "string",
  price: "string",
};

const SERVICE_TRADES: Record<string, FieldDef> = {
  ...SERVICE_PRICED,
  icon: "string",
};

const CONTACT_COPY: Record<string, FieldDef> = {
  phone: "string",
  email: "string",
  address: "string",
  cta: {
    type: "object",
    fields: {
      title: "string",
      description: "string",
      button_text: "string",
    },
  },
};

const CONTACT_BASIC: Record<string, FieldDef> = {
  phone: "string",
  email: "string",
  address: "string",
};

const NAV_MENU_BEAUTY: Record<string, FieldDef> = {
  about: "string",
  pricing: "string",
  gallery: "string",
  faq: "string",
  contact: "string",
  reviews: "string",
};

const BASE_NAV = (menu: Record<string, FieldDef>): FieldDef => ({
  type: "object",
  fields: {
    logo: "string",
    cta: "string",
    menu: { type: "object", fields: menu },
  },
});

const HERO_COMMON: Record<string, FieldDef> = {
  name: "string",
  headline: "string",
  subheadline: "string",
  description: "string",
  button: "string",
};

const MANIFESTO: FieldDef = {
  type: "object",
  fields: { label: "string", title: "string", text: "string" },
};

const SEO: FieldDef = {
  type: "object",
  fields: { title: "string", description: "string" },
};

/** Drzewa copy per motyw (klucze pod `pl`). */
export const AI_COPY_SCHEMAS: Record<string, Record<string, FieldDef>> = {
  beauty: {
    nav: BASE_NAV(NAV_MENU_BEAUTY),
    hero: {
      type: "object",
      fields: { ...HERO_COMMON, qrText: "string" },
    },
    manifesto: MANIFESTO,
    services: { type: "array", item: SERVICE_BASIC, maxItems: 8 },
    faq: { type: "array", item: FAQ_ITEM, maxItems: 8 },
    contact: { type: "object", fields: CONTACT_COPY },
    google_reviews: { type: "object", fields: { title: "string" } },
    gallery: { type: "object", fields: { title: "string" } },
    seo: SEO,
  },
  consultant: {
    nav: BASE_NAV({
      about: "string",
      pricing: "string",
      faq: "string",
      reviews: "string",
      contact: "string",
    }),
    hero: { type: "object", fields: HERO_COMMON },
    manifesto: MANIFESTO,
    services: { type: "array", item: SERVICE_BASIC, maxItems: 8 },
    proof: {
      type: "object",
      fields: {
        label: "string",
        title: "string",
        text: "string",
        statNumber: "string",
        statLabel: "string",
        statDesc: "string",
      },
    },
    faq: { type: "array", item: FAQ_ITEM, maxItems: 8 },
    reviews: {
      type: "array",
      item: { author: "string", content: "string" },
      maxItems: 6,
    },
    contact: { type: "object", fields: CONTACT_COPY },
    google_reviews: { type: "object", fields: { title: "string" } },
    gallery: { type: "object", fields: { title: "string" } },
    seo: SEO,
    footer: {
      type: "object",
      fields: { quote: "string", copyright: "string", privacy: "string" },
    },
  },
  fitness: {
    nav: BASE_NAV({
      about: "string",
      pricing: "string",
      schedule: "string",
      gallery: "string",
      faq: "string",
      contact: "string",
      reviews: "string",
    }),
    hero: {
      type: "object",
      fields: { ...HERO_COMMON, qrText: "string" },
    },
    manifesto: MANIFESTO,
    services: { type: "array", item: SERVICE_PRICED, maxItems: 8 },
    schedule: {
      type: "array",
      item: { day: "string", time: "string", note: "string" },
      maxItems: 7,
    },
    faq: { type: "array", item: FAQ_ITEM, maxItems: 8 },
    contact: { type: "object", fields: CONTACT_COPY },
    google_reviews: { type: "object", fields: { title: "string" } },
    gallery: { type: "object", fields: { title: "string" } },
    seo: SEO,
  },
  services: {
    nav: BASE_NAV({
      about: "string",
      pricing: "string",
      gallery: "string",
      trust: "string",
      faq: "string",
      contact: "string",
      reviews: "string",
    }),
    hero: {
      type: "object",
      fields: { ...HERO_COMMON, qrText: "string" },
    },
    manifesto: MANIFESTO,
    services: { type: "array", item: SERVICE_TRADES, maxItems: 8 },
    trust: {
      type: "object",
      fields: {
        title: "string",
        quote: "string",
        author: "string",
        subtitle: "string",
      },
    },
    faq: { type: "array", item: FAQ_ITEM, maxItems: 8 },
    contact: { type: "object", fields: CONTACT_COPY },
    google_reviews: { type: "object", fields: { title: "string" } },
    gallery: { type: "object", fields: { title: "string" } },
    seo: SEO,
  },
  gastro: {
    nav: BASE_NAV({
      menu: "string",
      orders: "string",
      location: "string",
      contact: "string",
    }),
    hero: { type: "object", fields: HERO_COMMON },
    manifesto: MANIFESTO,
    hours: {
      type: "object",
      fields: {
        title: "string",
        lines: { type: "stringArray", maxItems: 6 },
      },
    },
    orders: {
      type: "object",
      fields: {
        label: "string",
        title: "string",
        description: "string",
        call_button: "string",
      },
    },
    sections: {
      type: "object",
      fields: {
        menu_label: "string",
        location_label: "string",
        contact_title: "string",
      },
    },
    hero_actions: {
      type: "object",
      fields: { menu_button: "string", call_button: "string" },
    },
    menu_items: {
      type: "array",
      item: {
        category: "string",
        name: "string",
        ingredients: "string",
        price: "string",
      },
      maxItems: 16,
    },
    faq: { type: "array", item: FAQ_ITEM, maxItems: 6 },
    contact: { type: "object", fields: CONTACT_BASIC },
    seo: SEO,
  },
  care: {
    nav: BASE_NAV({
      about: "string",
      help: "string",
      pricing: "string",
      contact: "string",
    }),
    hero: { type: "object", fields: HERO_COMMON },
    manifesto: MANIFESTO,
    help_areas: {
      type: "array",
      item: { title: "string", desc: "string" },
      maxItems: 8,
    },
    certificates: {
      type: "array",
      item: { title: "string", issuer: "string" },
      maxItems: 8,
    },
    services: { type: "array", item: SERVICE_PRICED, maxItems: 8 },
    faq: { type: "array", item: FAQ_ITEM, maxItems: 8 },
    contact: { type: "object", fields: CONTACT_BASIC },
    seo: SEO,
  },
};

export const PUBLISHED_AI_THEMES = Object.keys(AI_COPY_SCHEMAS);

export function getCopySchemaForTheme(theme: string): Record<string, FieldDef> | null {
  const id = String(theme || "").trim().toLowerCase();
  return AI_COPY_SCHEMAS[id] || null;
}

/** Gemini REST responseSchema (uppercase types). */
export function buildGeminiResponseSchema(theme: string): Record<string, unknown> | null {
  const fields = getCopySchemaForTheme(theme);
  if (!fields) return null;
  return fieldDefToGeminiSchema({ type: "object", fields });
}

function fieldDefToGeminiSchema(def: FieldDef): Record<string, unknown> {
  if (def === "string") {
    return { type: "STRING" };
  }
  if (def.type === "object") {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, child] of Object.entries(def.fields)) {
      properties[key] = fieldDefToGeminiSchema(child);
      required.push(key);
    }
    return {
      type: "OBJECT",
      properties,
      required,
    };
  }
  if (def.type === "stringArray") {
    const schema: Record<string, unknown> = {
      type: "ARRAY",
      items: { type: "STRING" },
    };
    if (typeof def.maxItems === "number") schema.maxItems = def.maxItems;
    return schema;
  }
  // array of objects
  const itemProps: Record<string, unknown> = {};
  const itemRequired: string[] = [];
  for (const [key, child] of Object.entries(def.item)) {
    itemProps[key] = fieldDefToGeminiSchema(child);
    itemRequired.push(key);
  }
  const schema: Record<string, unknown> = {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: itemProps,
      required: itemRequired,
    },
  };
  if (typeof def.maxItems === "number") {
    schema.maxItems = def.maxItems;
  }
  return schema;
}

/**
 * Merge patch copy into existing `pl` according to schema whitelist.
 * contact.phone/email/address: only fill when existing value is empty.
 */
export function mergeAiCopyPatch(
  existingPl: Record<string, unknown>,
  patch: Record<string, unknown>,
  theme: string,
): Record<string, unknown> {
  const schema = getCopySchemaForTheme(theme);
  if (!schema) return existingPl;
  const out = deepClone(existingPl);
  for (const key of Object.keys(schema)) {
    if (!(key in patch)) continue;
    out[key] = mergeNode(out[key], patch[key], schema[key], key === "contact");
  }
  return out;
}

function mergeNode(
  existing: unknown,
  patch: unknown,
  def: FieldDef,
  isContactRoot: boolean,
): unknown {
  if (def === "string") {
    if (typeof patch !== "string") return existing ?? "";
    return patch;
  }
  if (def.type === "stringArray") {
    if (!Array.isArray(patch)) return Array.isArray(existing) ? existing : [];
    return patch.map((row) => String(row ?? "")).filter((s) => s.length > 0);
  }
  if (def.type === "array") {
    if (!Array.isArray(patch)) return Array.isArray(existing) ? existing : [];
    return patch.map((item) => {
      if (!item || typeof item !== "object") return {};
      const row: Record<string, unknown> = {};
      for (const [k, childDef] of Object.entries(def.item)) {
        row[k] = mergeNode(
          undefined,
          (item as Record<string, unknown>)[k],
          childDef,
          false,
        );
      }
      return row;
    });
  }
  // object
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? deepClone(existing as Record<string, unknown>)
      : {};
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return base;
  const p = patch as Record<string, unknown>;
  for (const [k, childDef] of Object.entries(def.fields)) {
    if (!(k in p)) continue;
    if (isContactRoot && (k === "phone" || k === "email" || k === "address")) {
      const cur = typeof base[k] === "string" ? String(base[k]).trim() : "";
      if (cur) continue;
      const next = typeof p[k] === "string" ? String(p[k]).trim() : "";
      if (next) base[k] = next;
      continue;
    }
    base[k] = mergeNode(base[k], p[k], childDef, false);
  }
  return base;
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export const THEME_TONE_HINTS: Record<string, string> = {
  beauty: "ciepły, estetyczny, spokojny — beauty & wellness",
  consultant: "ekspercki, konkretny, budzący zaufanie — coaching/biznes",
  fitness: "energiczny, motywujący, bez ściemy — trening i studio",
  services: "konkretny, lokalny, rzemieślniczy — usługi remontowe/naprawcze",
  gastro: "apetyczny, gościnny, zmysłowy — restauracja/kawiarnia",
  care: "spokojny, profesjonalny, empatyczny — gabinet medyczny/terapia",
};
