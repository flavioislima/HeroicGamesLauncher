import { makeListenerCaller, makeHandlerInvoker, frontendListenerSlot } from '../ipc'

export const clearCache = makeListenerCaller('clearCache')
export const clearAchievementCache = makeListenerCaller('clearAchievementCache')
export const resetHeroic = makeListenerCaller('resetHeroic')
export const openWeblate = makeListenerCaller('openWeblate')
export const changeLanguage = makeListenerCaller('changeLanguage')
export const openExternalUrl = makeListenerCaller('openExternalUrl')
export const getHeroicVersion = makeHandlerInvoker('getHeroicVersion')
export const getLatestReleases = makeHandlerInvoker('getLatestReleases')
export const getCurrentChangelog = makeHandlerInvoker('getCurrentChangelog')
export const openPatreonPage = makeListenerCaller('openPatreonPage')
export const openKofiPage = makeListenerCaller('openKofiPage')
export const openGithubSponsorsPage = makeListenerCaller('openGithubSponsorsPage')
export const isFullscreen = makeHandlerInvoker('isFullscreen')
export const isFrameless = makeHandlerInvoker('isFrameless')
export const isMinimized = makeHandlerInvoker('isMinimized')
export const isMaximized = makeHandlerInvoker('isMaximized')
export const minimizeWindow = makeListenerCaller('minimizeWindow')
export const maximizeWindow = makeListenerCaller('maximizeWindow')
export const unmaximizeWindow = makeListenerCaller('unmaximizeWindow')
export const closeWindow = makeListenerCaller('closeWindow')
export const setFullscreen = makeListenerCaller('setFullscreen')
export const handleMaximized = frontendListenerSlot('maximized')
export const handleUnmaximized = frontendListenerSlot('unmaximized')
export const handleFullscreen = frontendListenerSlot('fullscreen')
export const openWebviewPage = makeListenerCaller('openWebviewPage')
export const setZoomFactor = makeListenerCaller('setZoomFactor')
export const frontendReady = makeListenerCaller('frontendReady')
export const lock = makeListenerCaller('lock')
export const unlock = makeListenerCaller('unlock')
export const login = makeHandlerInvoker('login')
export const logoutLegendary = makeHandlerInvoker('logoutLegendary')
export const authGOG = makeHandlerInvoker('authGOG')
export const logoutGOG = makeListenerCaller('logoutGOG')
export const getAmazonLoginData = makeHandlerInvoker('getAmazonLoginData')
export const authAmazon = makeHandlerInvoker('authAmazon')
export const logoutAmazon = makeHandlerInvoker('logoutAmazon')
export const getItchioLoginData = makeHandlerInvoker('getItchioLoginData')
export const getItchioUserInfo = makeHandlerInvoker('getItchioUserInfo')
export const authItchio = makeHandlerInvoker('authItchio')
export const logoutItchio = makeHandlerInvoker('logoutItchio')
export const checkGameUpdates = makeHandlerInvoker('checkGameUpdates')
export const refreshLibrary = makeHandlerInvoker('refreshLibrary')
export const gamepadAction = makeHandlerInvoker('gamepadAction')
export const logError = makeListenerCaller('logError')
export const logInfo = makeListenerCaller('logInfo')
export const showConfigFileInFolder = makeListenerCaller('showConfigFileInFolder')
export const openFolder = makeListenerCaller('openFolder')
export const syncGOGSaves = makeHandlerInvoker('syncGOGSaves')
export const checkDiskSpace = makeHandlerInvoker('checkDiskSpace')
export const getGOGLinuxInstallersLangs = makeHandlerInvoker('getGOGLinuxInstallersLangs')
export const getAlternativeWine = makeHandlerInvoker('getAlternativeWine')
export const getShellPath = makeHandlerInvoker('getShellPath')
export const getWebviewPreloadPath = makeHandlerInvoker('getWebviewPreloadPath')
export const callTool = makeHandlerInvoker('callTool')
export const getAnticheatInfo = makeHandlerInvoker('getAnticheatInfo')
export const getKnownFixes = makeHandlerInvoker('getKnownFixes')
export const clipboardReadText = makeHandlerInvoker('clipboardReadText')
export const clipboardWriteText = makeListenerCaller('clipboardWriteText')
export const pathExists = makeHandlerInvoker('pathExists')
export const processShortcut = makeListenerCaller('processShortcut')
export const handleGoToScreen = frontendListenerSlot('openScreen')
export const handleShowDialog = frontendListenerSlot('showDialog')

import Store from 'electron-store'
// FUTURE WORK
// here is how the store methods can be refactored
// in order to set nodeIntegration: false
// but converting sync methods to async propagates through frontend

// export const storeNew = async (
//   name: string,
//   options: Store.Options<Record<string, unknown>>
// ) => ipcRenderer.send('storeNew', name, options)

// export const storeSet = async (name: string, key: string, value?: unknown) =>
//   ipcRenderer.send('storeSet', name, key, value)

// export const storeHas = async (name: string, key: string) =>
//   ipcRenderer.invoke('storeHas', name, key)

// export const storeGet = async (name: string, key: string) =>
//   ipcRenderer.invoke('storeGet', name, key)

interface StoreMap {
  [key: string]: Store
}
const stores: StoreMap = {}

export const storeNew = function (storeName: string, options: Store.Options<Record<string, unknown>>) {
  stores[storeName] = new Store(options)
}

export const storeSet = (storeName: string, key: string, value?: unknown) => stores[storeName].set(key, value)

export const storeHas = (storeName: string, key: string) => stores[storeName].has(key)

export const storeGet = (storeName: string, key: string, defaultValue?: unknown) =>
  stores[storeName].get(key, defaultValue)

export const storeDelete = (storeName: string, key: string) => stores[storeName].delete(key)

export const getWikiGameInfo = makeHandlerInvoker('getWikiGameInfo')
export const fetchPlaytimeFromServer = makeHandlerInvoker('getPlaytimeFromRunner')
export const getUploadedLogFiles = makeHandlerInvoker('getUploadedLogFiles')
export const uploadLogFile = makeHandlerInvoker('uploadLogFile')
export const deleteUploadedLogFile = makeHandlerInvoker('deleteUploadedLogFile')
export const logFileUploadedSlot = frontendListenerSlot('logFileUploaded')
export const logFileUploadDeletedSlot = frontendListenerSlot('logFileUploadDeleted')
export const isIntelMac = makeHandlerInvoker('isIntelMac')
export const steamgriddb = {
  hasApiKey: makeHandlerInvoker('steamgriddb.hasApiKey'),
  setApiKey: makeHandlerInvoker('steamgriddb.setApiKey'),
  searchGame: makeHandlerInvoker('steamgriddb.searchGame'),
  getGrids: makeHandlerInvoker('steamgriddb.getGrids')
}
