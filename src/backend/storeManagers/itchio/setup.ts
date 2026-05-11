import { existsSync, mkdirSync } from 'graceful-fs'

import { LogPrefix, logError, logInfo } from 'backend/logger'

import { itchioConfigPath } from './constants'

/**
 * Ensure butlerd's writable state directory exists. The daemon stores its
 * SQLite db under `itchioConfigPath`; without the directory, the very first
 * `Profile.LoginWithAPIKey` call fails with an obscure sqlite-open error.
 *
 * The butler binary itself is resolved via `getButlerBin()` — Heroic ships
 * one in `tools/butler/<arch>/butler` and falls back to a user-configured
 * `altButlerBin`. Auto-downloading butler from broth.itch.zone is out of
 * scope for this MVP.
 */
export default function setupItchio(): Promise<void> {
  if (!existsSync(itchioConfigPath)) {
    try {
      mkdirSync(itchioConfigPath, { recursive: true })
      logInfo(`Created itch.io config dir at ${itchioConfigPath}`, LogPrefix.Itchio)
    } catch (err) {
      logError(
        [`Failed to create ${itchioConfigPath}:`, (err as Error).message],
        LogPrefix.Itchio
      )
    }
  }
  return Promise.resolve()
}
