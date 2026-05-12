import axios from 'axios'
import { app } from 'electron'
import { addHandler } from 'backend/ipc'
import { logError, logInfo, LogPrefix, logWarning } from 'backend/logger'
import { GOGUser } from 'backend/storeManagers/gog/user'
import type {
  CatalogLocaleSettings,
  CatalogProduct
} from 'common/types/discounts'

interface CatalogResponse {
  pages: number
  productCount: number
  products: CatalogProduct[]
}

const CATALOG_URL = 'https://catalog.gog.com/v1/catalog'
const PAGE_LIMIT = 48
const MAX_PAGES = 30

const FALLBACK_LOCALE: CatalogLocaleSettings = {
  countryCode: 'US',
  locale: 'en-US',
  currencyCode: 'USD'
}

const isFallbackLocale = (locale: CatalogLocaleSettings) =>
  locale.countryCode === FALLBACK_LOCALE.countryCode &&
  locale.currencyCode === FALLBACK_LOCALE.currencyCode &&
  locale.locale === FALLBACK_LOCALE.locale

const buildUrl = (
  page: number,
  locale: CatalogLocaleSettings,
  hideOwned: boolean,
  wishlistOnly: boolean
) => {
  const params = new URLSearchParams({
    limit: String(PAGE_LIMIT),
    order: 'desc:trending',
    discounted: 'eq:true',
    productType: 'in:game,pack,dlc',
    page: String(page),
    countryCode: locale.countryCode,
    locale: locale.locale,
    currencyCode: locale.currencyCode
  })

  if (hideOwned) {
    params.append('hideOwned', 'true')
  }

  if (wishlistOnly) {
    params.append('wishlist', 'eq:true')
  }

  return `${CATALOG_URL}?${params.toString()}`
}

const fetchPage = async (
  page: number,
  locale: CatalogLocaleSettings,
  hideOwned: boolean,
  wishlistOnly: boolean,
  token: string | undefined
) => {
  const headers: Record<string, string> = {
    'User-Agent': `HeroicGamesLauncher/${app.getVersion()}`
  }

  if ((hideOwned && token) || (wishlistOnly && token)) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const { data } = await axios.get<CatalogResponse>(
    buildUrl(page, locale, hideOwned, wishlistOnly),
    {
      timeout: 15000,
      headers
    }
  )
  return data
}

const fetchAllDiscounts = async (
  locale: CatalogLocaleSettings,
  hideOwned: boolean,
  wishlistOnly: boolean,
  token: string | undefined
) => {
  const first = await fetchPage(1, locale, hideOwned, wishlistOnly, token)
  const totalPages = Math.min(first.pages, MAX_PAGES)
  if (totalPages <= 1) return first.products

  const rest = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, i) =>
      fetchPage(i + 2, locale, hideOwned, wishlistOnly, token)
        .then((d) => d.products)
        .catch((err: unknown) => {
          logError(
            `Failed to fetch discounts page ${i + 2}: ${String(err)}`,
            LogPrefix.Backend
          )
          return [] as CatalogProduct[]
        })
    )
  )

  const all = [...first.products, ...rest.flat()]
  // GOG's catalog is ordered by dynamic trending, so the same product can
  // appear on multiple pages if ranking shifts mid-fetch. Dedupe by id to
  // avoid duplicate React keys in the grid.
  const seen = new Set<string>()
  return all.filter((p) => {
    if (seen.has(p.id)) return false
    seen.add(p.id)
    return true
  })
}

addHandler(
  'getGogDiscounts',
  async (_event, locale, hideOwned = false, wishlistOnly = false) => {
    try {
      let token: string | undefined = undefined

      if (hideOwned || wishlistOnly) {
        const credentials = await GOGUser.getCredentials()
        if (credentials) {
          token = credentials.access_token
        } else {
          hideOwned = false
          wishlistOnly = false
          logWarning(
            'Failed to get user credentials: User maybe is not looged in',
            LogPrefix.Backend
          )
        }
      }

      const products = await fetchAllDiscounts(
        locale,
        hideOwned,
        wishlistOnly,
        token
      )
      if (products.length > 0 || isFallbackLocale(locale)) {
        return products
      }

      logInfo(
        `No discounts for ${locale.countryCode}/${locale.currencyCode}, retrying with US/USD`,
        LogPrefix.Backend
      )
      return await fetchAllDiscounts(
        FALLBACK_LOCALE,
        hideOwned,
        wishlistOnly,
        token
      )
    } catch (err) {
      logError(
        `Failed to fetch GOG discounts: ${String(err)}`,
        LogPrefix.Backend
      )
      throw err
    }
  }
)
