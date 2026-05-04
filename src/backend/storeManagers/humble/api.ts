import axios, { AxiosError } from 'axios'
import { LogPrefix, logDebug, logError } from 'backend/logger'
import {
  HUMBLE_API_BASE,
  HUMBLE_REQUEST_HEADER,
  HUMBLE_SESSION_COOKIE
} from './constants'
import { HumbleOrder } from 'common/types/humble'
import { configStore } from './electronStores'

// Humble's API rejects requests with no User-Agent or a generic "axios/x.y"
// string with HTTP 403, so impersonate a normal Chrome browser.
const HUMBLE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function authedHeaders(cookieValue: string) {
  return {
    'X-Requested-By': HUMBLE_REQUEST_HEADER,
    'User-Agent': HUMBLE_USER_AGENT,
    Cookie: `${HUMBLE_SESSION_COOKIE}=${cookieValue}`,
    Accept: 'application/json'
  }
}

function buildHeaders() {
  const cookie = configStore.get_nodefault('sessionCookie')
  if (!cookie) {
    throw new Error('Humble session cookie missing — user is logged out')
  }
  return authedHeaders(cookie)
}

export async function validateSession(cookieValue: string): Promise<boolean> {
  try {
    const res = await axios.get(`${HUMBLE_API_BASE}/api/v1/user/order`, {
      headers: authedHeaders(cookieValue),
      validateStatus: () => true,
      // Allow up to 30s — Humble can be slow on first call after login
      timeout: 30_000
    })
    if (res.status !== 200) {
      logError(
        [
          `Humble validateSession non-200 response:`,
          `status=${res.status}`,
          `body=${typeof res.data === 'string' ? res.data.slice(0, 200) : JSON.stringify(res.data).slice(0, 200)}`
        ],
        LogPrefix.Humble
      )
      return false
    }
    if (!Array.isArray(res.data)) {
      logError(
        [
          'Humble validateSession returned 200 but body was not an array:',
          JSON.stringify(res.data).slice(0, 200)
        ],
        LogPrefix.Humble
      )
      return false
    }
    logDebug(
      [`Humble validateSession ok — ${res.data.length} orders visible`],
      LogPrefix.Humble
    )
    return true
  } catch (error) {
    logError(['Failed to validate Humble session:', error], LogPrefix.Humble)
    return false
  }
}

async function getOrderKeys(): Promise<string[]> {
  const res = await axios.get<{ gamekey: string }[]>(
    `${HUMBLE_API_BASE}/api/v1/user/order`,
    { headers: buildHeaders() }
  )
  return res.data.map((o) => o.gamekey)
}

async function getOrder(gamekey: string): Promise<HumbleOrder> {
  const res = await axios.get<HumbleOrder>(
    `${HUMBLE_API_BASE}/api/v1/order/${gamekey}?all_tpkds=true`,
    { headers: buildHeaders() }
  )
  return res.data
}

export async function getAllOrders(): Promise<HumbleOrder[]> {
  const keys = await getOrderKeys()
  const orders: HumbleOrder[] = []
  const concurrency = 6
  for (let i = 0; i < keys.length; i += concurrency) {
    const batch = keys.slice(i, i + concurrency)
    const results = await Promise.allSettled(batch.map((k) => getOrder(k)))
    for (const r of results) {
      if (r.status === 'fulfilled') {
        orders.push(r.value)
      } else {
        logError(['Failed to fetch order:', r.reason], LogPrefix.Humble)
      }
    }
  }
  return orders
}

export function isUnauthorized(error: unknown): boolean {
  return (
    error instanceof AxiosError &&
    (error.response?.status === 401 || error.response?.status === 403)
  )
}
