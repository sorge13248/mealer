export interface ItemUserFields {
  food_macrocategory?: string | null;
  yuka_score?: number | string | null;
}

export interface Item {
  id: number;
  name: string;
  description?: string | null;
  picture_file_name?: string | null;
  userfields?: ItemUserFields | null;
}

export interface StockEntry {
  product_id: number | string;
  amount: number | string;
  amount_opened: number | string;
  best_before_date?: string | null;
}

export interface ProductStockSummary {
  amount: number;
  amountOpened: number;
  nearestBestBeforeDate: string | null;
}

export interface YukaScoreView {
  value: number;
  color: string;
}

const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;

export function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsedValue =
    typeof value === 'number' ? value : Number(value.trim().replace(',', '.'));

  return Number.isNaN(parsedValue) ? null : parsedValue;
}

export function parseDateOnly(value: string | null): Date | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, yearValue, monthValue, dayValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if ([year, month, day].some(Number.isNaN)) {
    return null;
  }

  return new Date(year, month - 1, day);
}

export function toBestBeforeTime(bestBeforeDate: string | null): number {
  const parsedDate = parseDateOnly(bestBeforeDate);
  if (!parsedDate) {
    return Number.POSITIVE_INFINITY;
  }

  return parsedDate.getTime();
}

export function getNearestBestBeforeDate(currentDate: string | null, candidateDate: string | null): string | null {
  const currentTime = toBestBeforeTime(currentDate);
  const candidateTime = toBestBeforeTime(candidateDate);

  if (candidateTime < currentTime) {
    return candidateDate;
  }

  return currentDate;
}

export function buildStockSummaryByProductId(stockEntries: StockEntry[]): Map<number, ProductStockSummary> {
  const stockSummaryMap = new Map<number, ProductStockSummary>();

  for (const stockEntry of stockEntries) {
    const productId = toNumber(stockEntry.product_id);
    if (productId === null) {
      continue;
    }

    const currentSummary =
      stockSummaryMap.get(productId) ?? {
        amount: 0,
        amountOpened: 0,
        nearestBestBeforeDate: null
      };

    const amount = toNumber(stockEntry.amount) ?? 0;
    const amountOpened = toNumber(stockEntry.amount_opened) ?? 0;
    const bestBeforeDate = stockEntry.best_before_date?.trim() || null;

    stockSummaryMap.set(productId, {
      amount: currentSummary.amount + amount,
      amountOpened: currentSummary.amountOpened + amountOpened,
      nearestBestBeforeDate: getNearestBestBeforeDate(currentSummary.nearestBestBeforeDate, bestBeforeDate)
    });
  }

  return stockSummaryMap;
}

export function getNormalizedYukaScore(item: Pick<Item, 'userfields'>): number | null {
  const rawYukaScore = item.userfields?.yuka_score;
  if (rawYukaScore === null || rawYukaScore === undefined || rawYukaScore === '') {
    return null;
  }

  const parsedYukaScore =
    typeof rawYukaScore === 'number' ? rawYukaScore : Number(rawYukaScore.trim().replace(',', '.'));
  if (Number.isNaN(parsedYukaScore)) {
    return null;
  }

  return Math.min(100, Math.max(0, Math.round(parsedYukaScore)));
}

export function getYukaScoreView(item: Pick<Item, 'userfields'>): YukaScoreView | null {
  const normalizedScore = getNormalizedYukaScore(item);
  if (normalizedScore === null) {
    return null;
  }

  const yukaHue = (normalizedScore / 100) * 120;

  return {
    value: normalizedScore,
    color: `hsl(${yukaHue} 74% 46%)`
  };
}

export function formatBestBeforeDate(bestBeforeDate: string | null, formatter: Intl.DateTimeFormat): string | null {
  const parsedDate = parseDateOnly(bestBeforeDate);
  if (!parsedDate) {
    return null;
  }

  return formatter.format(parsedDate);
}

export function getDaysUntilBestBeforeLabel(bestBeforeDate: string | null): string | null {
  const parsedDate = parseDateOnly(bestBeforeDate);
  if (!parsedDate) {
    return null;
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const daysUntil = Math.round((parsedDate.getTime() - startOfToday.getTime()) / ONE_DAY_IN_MS);

  if (daysUntil === 0) {
    return 'scade oggi';
  }

  if (daysUntil < 0) {
    const daysExpired = Math.abs(daysUntil);
    return daysExpired === 1 ? 'scaduto da 1 giorno' : `scaduto da ${daysExpired} giorni`;
  }

  return daysUntil === 1 ? 'fra 1 giorno' : `fra ${daysUntil} giorni`;
}
