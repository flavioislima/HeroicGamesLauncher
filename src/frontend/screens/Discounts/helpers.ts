import type {
  CatalogLocaleSettings,
  CatalogRating
} from 'common/types/discounts'

const GOG_AFFILIATE_ID = '1838482841'

// Only country and currency vary by language. GOG's catalog API rejects
// most locale values, so we always send en-US — the locale doesn't affect
// the discount listings, only the storeLink language path.
// GOG supports: AUD, BRL, CAD, CHF, CNY, DKK, EUR, GBP, NOK, PLN, SEK (in
// their respective regions) and USD everywhere. Unsupported native
// currencies fall back to USD.
const COUNTRY_CURRENCY_MAP: Record<
  string,
  { countryCode: string; currencyCode: string }
> = {
  en: { countryCode: 'US', currencyCode: 'USD' },
  pt_BR: { countryCode: 'BR', currencyCode: 'BRL' },
  pt: { countryCode: 'PT', currencyCode: 'EUR' },
  de: { countryCode: 'DE', currencyCode: 'EUR' },
  es: { countryCode: 'ES', currencyCode: 'EUR' },
  fr: { countryCode: 'FR', currencyCode: 'EUR' },
  it: { countryCode: 'IT', currencyCode: 'EUR' },
  nl: { countryCode: 'NL', currencyCode: 'EUR' },
  pl: { countryCode: 'PL', currencyCode: 'PLN' },
  ru: { countryCode: 'RU', currencyCode: 'USD' },
  uk: { countryCode: 'UA', currencyCode: 'USD' },
  ja: { countryCode: 'JP', currencyCode: 'USD' },
  ko: { countryCode: 'KR', currencyCode: 'USD' },
  zh_Hans: { countryCode: 'CN', currencyCode: 'CNY' },
  zh_Hant: { countryCode: 'TW', currencyCode: 'USD' },
  tr: { countryCode: 'TR', currencyCode: 'USD' },
  cs: { countryCode: 'CZ', currencyCode: 'USD' },
  hu: { countryCode: 'HU', currencyCode: 'USD' },
  sv: { countryCode: 'SE', currencyCode: 'SEK' },
  da: { countryCode: 'DK', currencyCode: 'DKK' },
  nb_NO: { countryCode: 'NO', currencyCode: 'NOK' },
  fi: { countryCode: 'FI', currencyCode: 'EUR' },
  el: { countryCode: 'GR', currencyCode: 'EUR' },
  ro: { countryCode: 'RO', currencyCode: 'USD' },
  ar: { countryCode: 'SA', currencyCode: 'USD' },
  he: { countryCode: 'IL', currencyCode: 'USD' }
}

const DEFAULT_COUNTRY_CURRENCY = { countryCode: 'US', currencyCode: 'USD' }

interface RegionOption {
  countryCode: string
  currencyCode: string
  label: string
}

// Deduplicated (countryCode+currencyCode) list for the Store override picker.
// Currencies are restricted to those GOG supports (AUD, BRL, CAD, CHF, CNY,
// DKK, EUR, GBP, NOK, PLN, SEK, USD); regions without a supported native
// currency use USD, which GOG accepts everywhere.
// Translation keys below are referenced via template literals, so list them
// here explicitly for i18next-parser to extract.
// t('discounts.region.countries.AU', 'Australia')
// t('discounts.region.countries.BR', 'Brazil')
// t('discounts.region.countries.CA', 'Canada')
// t('discounts.region.countries.CH', 'Switzerland')
// t('discounts.region.countries.CN', 'China')
// t('discounts.region.countries.CZ', 'Czechia')
// t('discounts.region.countries.DE', 'Germany')
// t('discounts.region.countries.DK', 'Denmark')
// t('discounts.region.countries.ES', 'Spain')
// t('discounts.region.countries.FI', 'Finland')
// t('discounts.region.countries.FR', 'France')
// t('discounts.region.countries.GB', 'United Kingdom')
// t('discounts.region.countries.GR', 'Greece')
// t('discounts.region.countries.HU', 'Hungary')
// t('discounts.region.countries.IL', 'Israel')
// t('discounts.region.countries.IT', 'Italy')
// t('discounts.region.countries.JP', 'Japan')
// t('discounts.region.countries.KR', 'South Korea')
// t('discounts.region.countries.NL', 'Netherlands')
// t('discounts.region.countries.NO', 'Norway')
// t('discounts.region.countries.PL', 'Poland')
// t('discounts.region.countries.PT', 'Portugal')
// t('discounts.region.countries.RO', 'Romania')
// t('discounts.region.countries.RU', 'Russia')
// t('discounts.region.countries.SE', 'Sweden')
// t('discounts.region.countries.TR', 'Turkey')
// t('discounts.region.countries.TW', 'Taiwan')
// t('discounts.region.countries.UA', 'Ukraine')
// t('discounts.region.countries.US', 'United States')
export const REGION_OPTIONS: RegionOption[] = [
  { countryCode: 'US', currencyCode: 'USD', label: 'United States' },
  { countryCode: 'AU', currencyCode: 'AUD', label: 'Australia' },
  { countryCode: 'BR', currencyCode: 'BRL', label: 'Brazil' },
  { countryCode: 'CA', currencyCode: 'CAD', label: 'Canada' },
  { countryCode: 'CN', currencyCode: 'CNY', label: 'China' },
  { countryCode: 'CZ', currencyCode: 'USD', label: 'Czechia' },
  { countryCode: 'DK', currencyCode: 'DKK', label: 'Denmark' },
  { countryCode: 'FI', currencyCode: 'EUR', label: 'Finland' },
  { countryCode: 'FR', currencyCode: 'EUR', label: 'France' },
  { countryCode: 'DE', currencyCode: 'EUR', label: 'Germany' },
  { countryCode: 'GR', currencyCode: 'EUR', label: 'Greece' },
  { countryCode: 'HU', currencyCode: 'USD', label: 'Hungary' },
  { countryCode: 'IL', currencyCode: 'USD', label: 'Israel' },
  { countryCode: 'IT', currencyCode: 'EUR', label: 'Italy' },
  { countryCode: 'JP', currencyCode: 'USD', label: 'Japan' },
  { countryCode: 'NL', currencyCode: 'EUR', label: 'Netherlands' },
  { countryCode: 'NO', currencyCode: 'NOK', label: 'Norway' },
  { countryCode: 'PL', currencyCode: 'PLN', label: 'Poland' },
  { countryCode: 'PT', currencyCode: 'EUR', label: 'Portugal' },
  { countryCode: 'RO', currencyCode: 'USD', label: 'Romania' },
  { countryCode: 'RU', currencyCode: 'USD', label: 'Russia' },
  { countryCode: 'KR', currencyCode: 'USD', label: 'South Korea' },
  { countryCode: 'ES', currencyCode: 'EUR', label: 'Spain' },
  { countryCode: 'SE', currencyCode: 'SEK', label: 'Sweden' },
  { countryCode: 'CH', currencyCode: 'CHF', label: 'Switzerland' },
  { countryCode: 'TW', currencyCode: 'USD', label: 'Taiwan' },
  { countryCode: 'TR', currencyCode: 'USD', label: 'Turkey' },
  { countryCode: 'UA', currencyCode: 'USD', label: 'Ukraine' },
  { countryCode: 'GB', currencyCode: 'GBP', label: 'United Kingdom' }
]

const LOCALE_OVERRIDE_KEY = 'discounts.regionOverride'

export const getStoredRegionOverride = (): string | null => {
  try {
    const stored = localStorage.getItem(LOCALE_OVERRIDE_KEY)
    if (!stored) return null
    return REGION_OPTIONS.some((r) => r.countryCode === stored) ? stored : null
  } catch {
    return null
  }
}

export const setStoredRegionOverride = (countryCode: string | null) => {
  try {
    if (countryCode) {
      localStorage.setItem(LOCALE_OVERRIDE_KEY, countryCode)
    } else {
      localStorage.removeItem(LOCALE_OVERRIDE_KEY)
    }
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
}

export const getLocaleSettings = (
  language: string,
  regionOverride?: string | null
): CatalogLocaleSettings => {
  if (regionOverride) {
    const match = REGION_OPTIONS.find((r) => r.countryCode === regionOverride)
    if (match) {
      return {
        countryCode: match.countryCode,
        currencyCode: match.currencyCode,
        locale: 'en-US'
      }
    }
  }

  const baseLang = language.split(/[-_]/)[0]
  const { countryCode, currencyCode } =
    COUNTRY_CURRENCY_MAP[language] ??
    COUNTRY_CURRENCY_MAP[baseLang] ??
    DEFAULT_COUNTRY_CURRENCY

  return { countryCode, currencyCode, locale: 'en-US' }
}

// GOG's affiliate program requires links to use the af.gog.com domain with
// the path of the original www.gog.com URL preserved, plus the ?as=<id>
// affiliate parameter. Links pointing at www.gog.com directly are not
// tracked by GOG even if ?as= is present.
export const withAffiliate = (storeLink: string): string => {
  try {
    const url = new URL(storeLink)
    url.hostname = 'af.gog.com'
    url.searchParams.set('as', GOG_AFFILIATE_ID)
    return url.toString()
  } catch {
    return storeLink
  }
}

export const parseDiscountPercent = (discount: string): number => {
  const match = /(\d+)/.exec(discount)
  return match ? parseInt(match[1], 10) : 0
}

export const parsePriceAmount = (amount?: string): number => {
  if (!amount) return 0
  const parsed = parseFloat(amount)
  return Number.isFinite(parsed) ? parsed : 0
}

export type DiscountSort =
  | 'trending'
  | 'discount'
  | 'price-asc'
  | 'price-desc'
  | 'release-asc'
  | 'release-desc'
  | 'rating-asc'
  | 'rating-desc'

export const parseReleaseTimestamp = (releaseDate?: string): number => {
  if (!releaseDate) return NaN
  const t = new Date(releaseDate).getTime()
  return Number.isFinite(t) ? t : NaN
}

export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const
export const DEFAULT_PAGE_SIZE: (typeof PAGE_SIZE_OPTIONS)[number] = 50
export const RATING_SCALE_MAX = 10
export const OS_OPTIONS = ['windows', 'linux', 'osx'] as const
export type OsOption = (typeof OS_OPTIONS)[number]

// GOG's reviewsRating is on a 0-50 scale; we display it as 0-10.
export const normalizeRating = (rating?: number): number => {
  if (!rating || rating <= 0) return 0
  return rating / 5
}

// PEGI is the most granular of the rating systems GOG returns and covers most
// of its catalog. We key the age-rating filter off PEGI for simplicity.
export const PEGI_AGE_OPTIONS = [3, 7, 12, 16, 18] as const
export type PegiAge = (typeof PEGI_AGE_OPTIONS)[number]

export const getPegiAge = (ratings?: CatalogRating[]): number | null => {
  if (!ratings) return null
  const pegi = ratings.find((r) => r.name === 'pegiRating')
  if (!pegi) return null
  const n = parseInt(pegi.ageRating, 10)
  return Number.isFinite(n) ? n : null
}

// Persisted filter state (excluding regionOverride, which has its own key).
// Stored in localStorage so filters survive navigation and page reloads.
interface StoredDiscountFilters {
  sortBy?: DiscountSort
  selectedGenres?: string[]
  selectedFeatures?: string[]
  selectedOS?: OsOption[]
  priceRange?: [number, number] | null
  ratingRange?: [number, number]
  releaseYearRange?: [number, number] | null
  maxPegiAge?: PegiAge | null
  searchQuery?: string
  hideDlcs?: boolean
  hideOwned?: boolean
  wishlistOnly?: boolean
  pageSize?: number
}

const FILTERS_STORAGE_KEY = 'discounts.filters'

export const loadStoredFilters = (): StoredDiscountFilters => {
  try {
    const raw = localStorage.getItem(FILTERS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return {}
    return parsed as StoredDiscountFilters
  } catch {
    return {}
  }
}

export const saveStoredFilters = (filters: StoredDiscountFilters) => {
  try {
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters))
  } catch {
    // ignore (private mode, quota, etc.)
  }
}
