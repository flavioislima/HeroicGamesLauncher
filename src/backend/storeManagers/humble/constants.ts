import { appFolder } from 'backend/constants/paths'
import { join } from 'path'

export const HUMBLE_API_BASE = 'https://www.humblebundle.com'
// All Humble API calls require this header — without it the API responds 403.
export const HUMBLE_REQUEST_HEADER = 'hb_android_app'
export const HUMBLE_SESSION_COOKIE = '_simpleauth_sess'
export const HUMBLE_PARTITION = 'persist:humble'

export const humbleConfigPath = join(appFolder, 'humble_config')
export const humbleOrdersCachePath = join(humbleConfigPath, 'orders.json')
export const humbleInstalledPath = join(humbleConfigPath, 'installed.json')
