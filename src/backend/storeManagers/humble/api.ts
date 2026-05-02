import axios, { AxiosError } from 'axios'
import { LogPrefix, logError } from 'backend/logger'
import {
  HUMBLE_API_BASE,
  HUMBLE_REQUEST_HEADER,
  HUMBLE_SESSION_COOKIE
} from './constants'
import { HumbleOrder } from 'common/types/humble'
import { configStore } from './electronStores'

function buildHeaders() {
  const cookie = configStore.get_nodefault('sessionCookie')
  if (!cookie) {
    throw new Error('Humble session cookie missing — user is logged out')
  }
  return {
    'X-Requested-By': HUMBLE_REQUEST_HEADER,
    Cookie: `${HUMBLE_SESSION_COOKIE}=${cookie}`,
    Accept: 'application/json'
  }
}

export async function validateSession(cookieValue: string): Promise<boolean> {
  try {
    const res = await axios.get(`${HUMBLE_API_BASE}/api/v1/user/order`, {
      headers: {
        'X-Requested-By': HUMBLE_REQUEST_HEADER,
        Cookie: `${HUMBLE_SESSION_COOKIE}=${cookieValue}`,
        Accept: 'application/json'
      },
      validateStatus: () => true
    })
    return res.status === 200 && Array.isArray(res.data)
  } catch (error) {
    logError(['Failed to validate Humble session:', error], LogPrefix.Humble)
    return false
  }
}

export async function getOrderKeys(): Promise<string[]> {
  const res = await axios.get<{ gamekey: string }[]>(
    `${HUMBLE_API_BASE}/api/v1/user/order`,
    { headers: buildHeaders() }
  )
  return res.data.map((o) => o.gamekey)
}

export async function getOrder(gamekey: string): Promise<HumbleOrder> {
  const res = await axios.get<HumbleOrder>(
    `${HUMBLE_API_BASE}/api/v1/order/${gamekey}?all_tpkds=true`,
    { headers: buildHeaders() }
  )
  return res.data
}

export async function getAllOrders(): Promise<HumbleOrder[]> {
  const keys = await getOrderKeys()
  const orders: HumbleOrder[] = []
  // Fetch with limited concurrency to avoid hammering the API
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
