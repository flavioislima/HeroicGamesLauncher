import {
  LogPrefix,
  logDebug,
  logError,
  logInfo,
  logWarning
} from 'backend/logger'
import { session } from 'electron'
import { HumbleUserData } from 'common/types/humble'
import { configStore } from './electronStores'
import { HUMBLE_PARTITION, HUMBLE_SESSION_COOKIE } from './constants'
import { clearCache } from 'backend/utils'
import { validateSession } from './api'

async function readSessionCookieFromPartition(): Promise<string | undefined> {
  try {
    const partitionSession = session.fromPartition(HUMBLE_PARTITION)
    // Don't filter by URL — Humble sets the cookie on `.humblebundle.com`
    // and the URL match is finicky depending on the cookie's secure/SameSite
    // flags. Reading everything in the partition and filtering by name is
    // both simpler and easier to debug.
    const allCookies = await partitionSession.cookies.get({})
    logDebug(
      [
        `Found ${allCookies.length} cookie(s) in Humble partition:`,
        allCookies.map((c) => `${c.domain}:${c.name}`).join(', ')
      ],
      LogPrefix.Humble
    )
    const sessionCookie = allCookies.find(
      (c) => c.name === HUMBLE_SESSION_COOKIE
    )
    if (!sessionCookie) {
      logWarning(
        `No ${HUMBLE_SESSION_COOKIE} cookie found in partition`,
        LogPrefix.Humble
      )
      return undefined
    }
    logDebug(
      [
        `Found session cookie on domain ${sessionCookie.domain}, length=${sessionCookie.value.length}`
      ],
      LogPrefix.Humble
    )
    return sessionCookie.value
  } catch (error) {
    logError(
      ['Failed to read Humble session cookie from webview partition:', error],
      LogPrefix.Humble
    )
    return undefined
  }
}

export class HumbleUser {
  /**
   * Called by the renderer once the login webview navigated to /home/library.
   * Reads the session cookie from the webview partition, validates it against
   * the Humble API, and persists user info if successful.
   */
  static async login(): Promise<{
    status: 'done' | 'failed'
    user: HumbleUserData | undefined
  }> {
    logInfo('Attempting Humble login', LogPrefix.Humble)
    const cookie = await readSessionCookieFromPartition()
    if (!cookie) {
      // Not necessarily an error: this fires on every humblebundle.com page
      // navigation, before the user has finished signing in.
      return { status: 'failed', user: undefined }
    }

    const valid = await validateSession(cookie)
    if (!valid) {
      logError(
        `Humble session cookie did not validate (cookie length: ${cookie.length})`,
        LogPrefix.Humble
      )
      return { status: 'failed', user: undefined }
    }

    configStore.set('sessionCookie', cookie)

    // Humble does not expose a "/me" endpoint that returns a stable display
    // name; we synthesize one from the cookie payload, which is a base64
    // urlencoded JSON blob. If parsing fails we fall back to a static label.
    const user = parseUserFromCookie(cookie) ?? {
      user_id: 'humble-user',
      username: 'Humble Bundle'
    }
    configStore.set('userData', user)
    logInfo('Humble login successful', LogPrefix.Humble)
    return { status: 'done', user }
  }

  static async logout() {
    configStore.delete('userData')
    configStore.delete('sessionCookie')
    try {
      const partitionSession = session.fromPartition(HUMBLE_PARTITION)
      await partitionSession.clearStorageData({
        storages: ['cookies', 'localstorage']
      })
    } catch (error) {
      logError(
        ['Failed to clear Humble session storage:', error],
        LogPrefix.Humble
      )
    }
    clearCache('humble')
  }

  static getUserData(): HumbleUserData | undefined {
    return configStore.get_nodefault('userData')
  }

  static isLoggedIn(): boolean {
    return Boolean(configStore.get_nodefault('sessionCookie'))
  }
}

function parseUserFromCookie(cookie: string): HumbleUserData | undefined {
  try {
    // The simpleauth cookie is URL-encoded JSON wrapped with a signature
    // suffix after the final `|`. We only care about the JSON body.
    const decoded = decodeURIComponent(cookie)
    const jsonPart = decoded.split('|')[0]
    if (!jsonPart.startsWith('{')) return undefined
    const data = JSON.parse(jsonPart) as {
      user_id?: number | string
      username?: string
      email?: string
    }
    if (!data.user_id) return undefined
    return {
      user_id: String(data.user_id),
      username: data.username ?? data.email ?? 'Humble User',
      email: data.email
    }
  } catch {
    return undefined
  }
}
