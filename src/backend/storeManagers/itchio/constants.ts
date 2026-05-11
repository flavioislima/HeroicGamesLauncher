import { appFolder, toolsPath } from 'backend/constants/paths'
import { join } from 'path'

export const itchioConfigPath = join(appFolder, 'itchio_config')
export const butlerDbPath = join(itchioConfigPath, 'butler.db')
export const itchioInstalledFile = join(itchioConfigPath, 'installed.json')
export const itchioLibraryFile = join(itchioConfigPath, 'library.json')
export const itchioUserDataFile = join(itchioConfigPath, 'user.json')

// Where Heroic stores the downloaded butler binary when no system / custom
// binary is configured. setup.ts is responsible for populating this path on
// first use.
export const butlerToolPath = join(toolsPath, 'butler')

// Heroic's registered OAuth client id at itch.io. Populated in PR #2 — kept
// as an exported constant so the daemon client wiring is in place.
export const itchioOAuthClientId = ''

// itch.io redirects PKCE callbacks back through Heroic's custom protocol
// handler. Matches the `heroic://` scheme registered in protocol.ts.
export const itchioOAuthRedirectUri = 'heroic://itchio/callback'
