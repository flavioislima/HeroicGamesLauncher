import { appFolder } from 'backend/constants/paths'
import { join } from 'path'

// Heroic-managed Maxima config dir. Maxima reads/writes its own state
// (auth tokens, installed games, manifest cache) here. Mirrors
// `nileConfigPath` for parity.
export const eaConfigPath = join(appFolder, 'ea_config', 'maxima')
export const eaInstalled = join(eaConfigPath, 'installed.json')
export const eaLibrary = join(eaConfigPath, 'library.json')
export const eaUserData = join(eaConfigPath, 'user.json')

// Local TCP port where the helper binary listens for the OAuth code
// callback (matches Maxima's hardcoded port 31033).
export const eaOAuthCallbackPort = 31033
