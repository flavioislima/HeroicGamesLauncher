import { LogPrefix, logInfo } from 'backend/logger'

import { itchioConfigPath } from './constants'

/**
 * Ensure the butler binary and its config directory are available.
 *
 * butler is itch.io's open-source CLI/daemon. In PR #2 this will:
 *  - Resolve the binary from `getButlerBin()` (custom override > bundled
 *    `tools/butler/butler`).
 *  - Download/extract a pinned release from https://broth.itch.zone/butler/
 *    when no binary is present.
 *  - Create `itchioConfigPath` so butlerd can write its SQLite db.
 *
 * For now it just records that itch.io support hasn't initialised any state.
 */
export default function setupItchio(): Promise<void> {
  logInfo(
    `itch.io setup placeholder; config path will be ${itchioConfigPath}`,
    LogPrefix.Itchio
  )
  return Promise.resolve()
}
