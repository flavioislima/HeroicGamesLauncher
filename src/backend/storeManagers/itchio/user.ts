import { LogPrefix, logInfo, logWarning } from 'backend/logger'
import {
  ItchioLoginData,
  ItchioRegisterData,
  ItchioUserData
} from 'common/types/itchio'

import { configStore } from './electronStores'

const NOT_IMPLEMENTED =
  'itch.io integration: butlerd login flow is not yet implemented'

export class ItchioUser {
  /**
   * Generate the data the renderer needs to start an OAuth PKCE flow:
   * authorize URL, code verifier, state. Filled in once the OAuth client
   * registration + PKCE helpers land in PR #2.
   */
  static getLoginData(): Promise<ItchioLoginData> {
    logWarning(NOT_IMPLEMENTED, LogPrefix.Itchio)
    return Promise.reject(new Error(NOT_IMPLEMENTED))
  }

  /**
   * Exchange the OAuth code returned by itch.io for a session and persist
   * the user via butlerd's `Profile.LoginWithOAuthCode`.
   */
  static login(
    data: ItchioRegisterData
  ): Promise<{ status: 'done' | 'failed'; user: ItchioUserData | undefined }> {
    logWarning(
      ['itchio login attempted but not implemented; data:', data],
      LogPrefix.Itchio
    )
    return Promise.resolve({ status: 'failed', user: undefined })
  }

  static logout(): Promise<void> {
    configStore.delete('userData')
    logInfo('itch.io session cleared', LogPrefix.Itchio)
    return Promise.resolve()
  }

  static getUserData(): Promise<ItchioUserData | undefined> {
    return Promise.resolve(configStore.get_nodefault('userData'))
  }

  static isLoggedIn(): boolean {
    return Boolean(configStore.get_nodefault('userData'))
  }
}
