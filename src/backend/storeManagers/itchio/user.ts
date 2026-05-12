import { LogPrefix, logError, logInfo, logWarning } from 'backend/logger'
import {
  ItchioLoginData,
  ItchioRegisterData,
  ItchioUserData
} from 'common/types/itchio'

import { getClient } from './butlerd'
import { configStore } from './electronStores'

/**
 * butlerd Profile shape (subset). The daemon returns `id`, `user`, and
 * `last_connected`; we only care about `id` (to call UseSavedLogin /
 * Forget later) and `user`.
 */
interface ButlerdProfile {
  id: number
  user: ItchioUserData
}

interface LoginWithAPIKeyResult {
  profile: ButlerdProfile
}

interface ProfileListResult {
  profiles: ButlerdProfile[]
}

interface UseSavedLoginResult {
  profile: ButlerdProfile
}

const API_KEYS_URL = 'https://itch.io/user/settings/api-keys'

export class ItchioUser {
  /**
   * Tell the renderer where to send the user to generate a personal API key.
   * The renderer then collects the key and passes it back via `login()`.
   */
  static getLoginData(): Promise<ItchioLoginData> {
    return Promise.resolve({ apiKeysUrl: API_KEYS_URL })
  }

  static async login(
    data: ItchioRegisterData
  ): Promise<{ status: 'done' | 'failed'; user: ItchioUserData | undefined }> {
    const apiKey = data.apiKey?.trim()
    if (!apiKey) {
      logError('itch.io login called without an API key', LogPrefix.Itchio)
      return { status: 'failed', user: undefined }
    }

    try {
      const client = await getClient()
      const result = await client.call<LoginWithAPIKeyResult>(
        'Profile.LoginWithAPIKey',
        { apiKey }
      )
      const { profile } = result
      configStore.set('profileId', profile.id)
      configStore.set('userData', profile.user)
      logInfo(
        `itch.io login succeeded as ${profile.user.username}`,
        LogPrefix.Itchio
      )
      return { status: 'done', user: profile.user }
    } catch (err) {
      logError(
        ['itch.io login failed:', (err as Error).message],
        LogPrefix.Itchio
      )
      return { status: 'failed', user: undefined }
    }
  }

  static async logout(): Promise<void> {
    const profileId = configStore.get_nodefault('profileId')
    if (profileId !== undefined) {
      try {
        const client = await getClient()
        await client.call('Profile.Forget', { profileId })
      } catch (err) {
        logWarning(
          ['Profile.Forget failed (continuing):', (err as Error).message],
          LogPrefix.Itchio
        )
      }
    }
    configStore.delete('userData')
    configStore.delete('profileId')
    logInfo('itch.io session cleared', LogPrefix.Itchio)
  }

  /**
   * Return cached user data, or — if butlerd has a saved profile we haven't
   * connected to yet this session — re-establish it via UseSavedLogin and
   * cache the result. Falls back to the locally stored profile on any
   * butlerd failure so the UI remains responsive offline.
   */
  static async getUserData(): Promise<ItchioUserData | undefined> {
    const cached = configStore.get_nodefault('userData')
    const profileId = configStore.get_nodefault('profileId')

    if (cached && profileId !== undefined) {
      // Best-effort refresh; failures don't invalidate the local cache.
      try {
        const client = await getClient()
        const result = await client.call<UseSavedLoginResult>(
          'Profile.UseSavedLogin',
          { profileId }
        )
        configStore.set('userData', result.profile.user)
        return result.profile.user
      } catch (err) {
        logWarning(
          [
            'itch.io Profile.UseSavedLogin failed, using cached user:',
            (err as Error).message
          ],
          LogPrefix.Itchio
        )
        return cached
      }
    }

    if (cached) return cached

    // No cache: ask butlerd if any profile was saved out of band.
    try {
      const client = await getClient()
      const { profiles } = await client.call<ProfileListResult>('Profile.List')
      if (profiles.length > 0) {
        const first = profiles[0]
        configStore.set('profileId', first.id)
        configStore.set('userData', first.user)
        return first.user
      }
    } catch (err) {
      logWarning(
        ['itch.io Profile.List failed:', (err as Error).message],
        LogPrefix.Itchio
      )
    }
    return undefined
  }

  static isLoggedIn(): boolean {
    return Boolean(configStore.get_nodefault('userData'))
  }
}
