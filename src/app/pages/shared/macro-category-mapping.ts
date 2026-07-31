export interface ParsedMacroCategoryName {
  title: string;
  subtitle: string | null;
}

export const EXCLUDED_MACROCATEGORY_NAMES: ReadonlyArray<string> = ['NA'];

export function normalizeMacroCategoryName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function parseMacroCategoryName(macroCategory: string): ParsedMacroCategoryName {
  const macroCategoryWithSubtitleRegex = /^(.*?)\s*\((.+)\)\s*$/;
  const matchedParts = macroCategory.match(macroCategoryWithSubtitleRegex);
  if (!matchedParts) {
    return {
      title: macroCategory,
      subtitle: null,
    };
  }

  const [, title, subtitle] = matchedParts;
  return {
    title: title.trim(),
    subtitle: subtitle.trim(),
  };
}

export function isExcludedMacroCategory(
  macroCategory: string,
  excludedNames: ReadonlyArray<string> = EXCLUDED_MACROCATEGORY_NAMES,
): boolean {
  const normalizedExcludedNames = new Set(
    excludedNames
      .map((categoryName) => normalizeMacroCategoryName(categoryName))
      .filter((categoryName) => categoryName.length > 0),
  );

  if (normalizedExcludedNames.size === 0) {
    return false;
  }

  const parsedCategory = parseMacroCategoryName(macroCategory);
  return (
    normalizedExcludedNames.has(normalizeMacroCategoryName(macroCategory)) ||
    normalizedExcludedNames.has(normalizeMacroCategoryName(parsedCategory.title))
  );
}

export const MEAL_PLANNER_CATEGORY = {
  CEREALI: 'cereali e derivati',
  FRUTTA_FRESCA: 'frutta fresca',
  FRUTTA_SECCA: 'frutta secca',
  GRASSI: 'grassi e condimenti',
  LATTICINI: 'latticini e formaggi',
  LEGUMI: 'legumi',
  PROTEINE_ANIMALI: 'proteine animali',
  PROTEINE_VEGETALI: 'proteine vegetali',
  VERDURA: 'verdura',
} as const;

export type KnownMealPlannerCategoryKey =
  (typeof MEAL_PLANNER_CATEGORY)[keyof typeof MEAL_PLANNER_CATEGORY];

export const KNOWN_MEAL_PLANNER_CATEGORY_OPTIONS: ReadonlyArray<{
  key: KnownMealPlannerCategoryKey;
  label: string;
}> = [
  { key: MEAL_PLANNER_CATEGORY.CEREALI, label: 'Cereali e derivati' },
  { key: MEAL_PLANNER_CATEGORY.FRUTTA_FRESCA, label: 'Frutta fresca' },
  { key: MEAL_PLANNER_CATEGORY.FRUTTA_SECCA, label: 'Frutta secca' },
  { key: MEAL_PLANNER_CATEGORY.GRASSI, label: 'Grassi e condimenti' },
  { key: MEAL_PLANNER_CATEGORY.LATTICINI, label: 'Latticini e formaggi' },
  { key: MEAL_PLANNER_CATEGORY.LEGUMI, label: 'Legumi' },
  { key: MEAL_PLANNER_CATEGORY.PROTEINE_ANIMALI, label: 'Proteine animali' },
  { key: MEAL_PLANNER_CATEGORY.PROTEINE_VEGETALI, label: 'Proteine vegetali' },
  { key: MEAL_PLANNER_CATEGORY.VERDURA, label: 'Verdura' },
];

export const KNOWN_MEAL_PLANNER_CATEGORY_LABELS: Record<KnownMealPlannerCategoryKey, string> = {
  [MEAL_PLANNER_CATEGORY.CEREALI]: 'Cereali e derivati',
  [MEAL_PLANNER_CATEGORY.FRUTTA_FRESCA]: 'Frutta fresca',
  [MEAL_PLANNER_CATEGORY.FRUTTA_SECCA]: 'Frutta secca',
  [MEAL_PLANNER_CATEGORY.GRASSI]: 'Grassi e condimenti',
  [MEAL_PLANNER_CATEGORY.LATTICINI]: 'Latticini e formaggi',
  [MEAL_PLANNER_CATEGORY.LEGUMI]: 'Legumi',
  [MEAL_PLANNER_CATEGORY.PROTEINE_ANIMALI]: 'Proteine animali',
  [MEAL_PLANNER_CATEGORY.PROTEINE_VEGETALI]: 'Proteine vegetali',
  [MEAL_PLANNER_CATEGORY.VERDURA]: 'Verdura',
};

export const KNOWN_MEAL_PLANNER_CATEGORY_SET = new Set<KnownMealPlannerCategoryKey>(
  KNOWN_MEAL_PLANNER_CATEGORY_OPTIONS.map((option) => option.key),
);

const MEAL_PLANNER_GUESSING_RULES: ReadonlyArray<{
  key: KnownMealPlannerCategoryKey;
  keywords: ReadonlyArray<string>;
}> = [
  {
    key: MEAL_PLANNER_CATEGORY.FRUTTA_SECCA,
    keywords: ['frutta secca', 'noci', 'mandorle', 'nocciole', 'anacardi', 'semi'],
  },
  {
    key: MEAL_PLANNER_CATEGORY.PROTEINE_VEGETALI,
    keywords: ['proteine vegetali', 'tofu', 'tempeh', 'seitan', 'soia'],
  },
  {
    key: MEAL_PLANNER_CATEGORY.PROTEINE_ANIMALI,
    keywords: ['proteine animali', 'carne', 'pesce', 'uova', 'salumi', 'pollo'],
  },
  {
    key: MEAL_PLANNER_CATEGORY.CEREALI,
    keywords: ['cereali', 'pasta', 'riso', 'pane', 'farine'],
  },
  {
    key: MEAL_PLANNER_CATEGORY.LEGUMI,
    keywords: ['legumi', 'fagioli', 'lenticchie', 'ceci'],
  },
  {
    key: MEAL_PLANNER_CATEGORY.GRASSI,
    keywords: ['grassi', 'condimenti', 'olio', 'olive'],
  },
  {
    key: MEAL_PLANNER_CATEGORY.LATTICINI,
    keywords: ['latticini', 'formaggi', 'latte', 'yogurt'],
  },
  {
    key: MEAL_PLANNER_CATEGORY.VERDURA,
    keywords: ['verdura', 'ortaggi', 'insalata'],
  },
  {
    key: MEAL_PLANNER_CATEGORY.FRUTTA_FRESCA,
    keywords: ['frutta fresca', 'frutta'],
  },
];

export function guessMealPlannerCategory(apiCategory: string): KnownMealPlannerCategoryKey | null {
  const normalizedCategory = normalizeMacroCategoryName(apiCategory);
  if (!normalizedCategory) {
    return null;
  }

  if (KNOWN_MEAL_PLANNER_CATEGORY_SET.has(normalizedCategory as KnownMealPlannerCategoryKey)) {
    return normalizedCategory as KnownMealPlannerCategoryKey;
  }

  const parsedCategory = parseMacroCategoryName(apiCategory);
  const normalizedTitle = normalizeMacroCategoryName(parsedCategory.title);

  if (KNOWN_MEAL_PLANNER_CATEGORY_SET.has(normalizedTitle as KnownMealPlannerCategoryKey)) {
    return normalizedTitle as KnownMealPlannerCategoryKey;
  }

  for (const option of KNOWN_MEAL_PLANNER_CATEGORY_OPTIONS) {
    if (normalizeMacroCategoryName(option.label) === normalizedTitle) {
      return option.key;
    }
  }

  for (const rule of MEAL_PLANNER_GUESSING_RULES) {
    if (
      rule.keywords.some(
        (keyword) =>
          normalizedCategory.includes(keyword) ||
          normalizedTitle.includes(keyword),
      )
    ) {
      return rule.key;
    }
  }

  return null;
}