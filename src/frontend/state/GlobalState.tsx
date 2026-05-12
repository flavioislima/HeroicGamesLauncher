import React, { PureComponent } from 'react'

import {
  ConnectivityStatus,
  FavouriteGame,
  GameInfo,
  GameStatus,
  HiddenGame,
  RefreshOptions,
  Runner,
  WineVersionInfo,
  LibraryTopSectionOptions,
  ExperimentalFeatures,
  Status
} from 'common/types'
import {
  DialogModalOptions,
  ExternalLinkDialogOptions,
  HelpItem
} from 'frontend/types'
import { withTranslation } from 'react-i18next'
import { getGameInfo, getLegendaryConfig } from '../helpers'
import { i18n, t, TFunction } from 'i18next'

import ContextProvider from './ContextProvider'

import {
  configStore,
  gogConfigStore,
  gogInstalledGamesStore,
  gogLibraryStore,
  libraryStore,
  nileConfigStore,
  nileLibraryStore,
  itchioConfigStore,
  itchioLibraryStore,
  wineDownloaderInfoStore,
  sideloadLibrary,
  zoomConfigStore,
  zoomInstalledGamesStore,
  zoomLibraryStore
} from '../helpers/electronStores'
import { IpcRendererEvent } from 'electron'
import { NileRegisterData } from 'common/types/nile'
import { ItchioRegisterData } from 'common/types/itchio'

const storage: Storage = window.localStorage
const globalSettings = configStore.get_nodefault('settings')

const RTL_LANGUAGES = ['fa', 'ar']

type T = TFunction<'gamepage'> & TFunction<'translations'>

interface Props {
  children: React.ReactNode
  i18n: i18n
  t: T
}

interface StateProps {
  epic: {
    library: GameInfo[]
    username?: string
  }
  gog: {
    library: GameInfo[]
    username?: string
  }
  amazon: {
    library: GameInfo[]
    user_id?: string
    username?: string
  }
  zoom: {
    library: GameInfo[]
    username?: string
    enabled: boolean
  }
  itchio: {
    library: GameInfo[]
    username?: string
  }
  wineVersions: WineVersionInfo[]
  error: boolean
  gameUpdates: string[]
  language: string
  libraryStatus: GameStatus[]
  libraryTopSection: string
  platform: NodeJS.Platform
  isIntelMac: boolean
  refreshing: boolean
  refreshingInTheBackground: boolean
  hiddenGames: HiddenGame[]
  favouriteGames: FavouriteGame[]
  customCategories: Record<string, string[]>
  currentCustomCategories: string[]
  theme: string
  isFullscreen: boolean
  isFrameless: boolean
  zoomPercent: number
  primaryFontFamily: string
  secondaryFontFamily: string
  allTilesInColor: boolean
  titlesAlwaysVisible: boolean
  sidebarCollapsed: boolean
  activeController: string
  connectivity: { status: ConnectivityStatus; retryIn: number }
  dialogModalOptions: DialogModalOptions
  externalLinkDialogOptions: ExternalLinkDialogOptions
  sideloadedLibrary: GameInfo[]
  hideChangelogsOnStartup: boolean
  lastChangelogShown: string | null
  showInstallModal: {
    show: boolean
    gameInfo: GameInfo | null
    appName: string
    runner: Runner
  }
  helpItems: { [key: string]: HelpItem }
  experimentalFeatures: ExperimentalFeatures
  disableDialogBackdropClose: boolean
  disableAnimations: boolean
}

// function to load the new key or fallback to the old one
const loadCurrentCategories = () => {
  const currentCategories = storage.getItem('current_custom_categories') || null
  if (!currentCategories) {
    const currentCategory = storage.getItem('current_custom_category') || null
    if (!currentCategory) {
      return []
    } else {
      return [currentCategory]
    }
  } else {
    return JSON.parse(currentCategories) as string[]
  }
}

class GlobalState extends PureComponent<Props> {
  loadGOGLibrary = (): Array<GameInfo> => {
    const games = gogLibraryStore.get('games', [])

    const installedGames = gogInstalledGamesStore.get('installed', [])
    for (const igame in games) {
      for (const installedGame of installedGames) {
        if (installedGame.appName === games[igame].app_name) {
          games[igame].install = installedGame
          games[igame].is_installed = true
        }
      }
    }

    return games
  }
  loadAmazonLibrary = (): Array<GameInfo> => {
    const games = nileLibraryStore.get('library', [])

    return games
  }

  loadItchioLibrary = (): Array<GameInfo> => {
    return itchioLibraryStore.get('library', [])
  }

  loadZoomLibrary = (): Array<GameInfo> => {
    const games = zoomLibraryStore.get('games', [])
    const installedGames = zoomInstalledGamesStore.get('installed', [])
    for (const game of games) {
      const igame = installedGames.find(
        (igame) => igame.appName === game.app_name
      )
      if (igame) {
        game.install = igame
        game.is_installed = true
      }
    }
    return games
  }

  state: StateProps = {
    epic: {
      library: libraryStore.get('library', []),
      username: configStore.get_nodefault('userInfo.displayName')
    },
    gog: {
      library: this.loadGOGLibrary(),
      username: gogConfigStore.get_nodefault('userData.username')
    },
    amazon: {
      library: this.loadAmazonLibrary(),
      user_id: nileConfigStore.get_nodefault('userData.user_id'),
      username: nileConfigStore.get_nodefault('userData.name')
    },
    zoom: {
      library: this.loadZoomLibrary(),
      username: zoomConfigStore.get_nodefault('username'),
      enabled: !!globalSettings?.experimentalFeatures?.zoomPlatform
    },
    itchio: {
      library: this.loadItchioLibrary(),
      username: itchioConfigStore.get_nodefault('userData.username')
    },
    wineVersions: wineDownloaderInfoStore.get('wine-releases', []),
    error: false,
    gameUpdates: [],
    language: this.props.i18n.language,
    libraryStatus: [],
    libraryTopSection: globalSettings?.libraryTopSection || 'disabled',
    platform: window.platform,
    isIntelMac: false,
    refreshing: false,
    refreshingInTheBackground: true,
    hiddenGames: configStore.get('games.hidden', []),
    currentCustomCategories: loadCurrentCategories(),
    sidebarCollapsed: JSON.parse(
      storage.getItem('sidebar_collapsed') || 'false'
    ),
    favouriteGames: configStore.get('games.favourites', []),
    customCategories: configStore.get('games.customCategories', {}),
    theme: configStore.get('theme', 'midnightMirage'),
    isFullscreen: false,
    isFrameless: false,
    zoomPercent: configStore.get('zoomPercent', 100),
    secondaryFontFamily:
      configStore.get_nodefault('contentFontFamily') ||
      getComputedStyle(document.documentElement).getPropertyValue(
        '--default-secondary-font-family'
      ),
    primaryFontFamily:
      configStore.get_nodefault('actionsFontFamily') ||
      getComputedStyle(document.documentElement).getPropertyValue(
        '--default-primary-font-family'
      ),
    allTilesInColor: configStore.get('allTilesInColor', false),
    titlesAlwaysVisible: configStore.get('titlesAlwaysVisible', false),
    activeController: '',
    connectivity: { status: 'offline', retryIn: 0 },
    showInstallModal: {
      show: false,
      appName: '',
      runner: 'legendary',
      gameInfo: null
    },
    sideloadedLibrary: sideloadLibrary.get('games', []),
    dialogModalOptions: { showDialog: false },
    externalLinkDialogOptions: { showDialog: false },
    hideChangelogsOnStartup: globalSettings?.hideChangelogsOnStartup || false,
    lastChangelogShown: JSON.parse(storage.getItem('last_changelog') || 'null'),
    helpItems: {},
    experimentalFeatures: {
      enableHelp: false,
      cometSupport: true,
      zoomPlatform: false,
      ...(globalSettings?.experimentalFeatures || {})
    },
    disableDialogBackdropClose: configStore.get(
      'disableDialogBackdropClose',
      false
    ),
    disableAnimations: configStore.get('disableAnimations', false)
  }

  setCurrentCustomCategories = (newCustomCategories: string[]) => {
    storage.setItem(
      'current_custom_categories',
      JSON.stringify(newCustomCategories)
    )
    this.setState({ currentCustomCategories: newCustomCategories })
  }

  setLanguage = (newLanguage: string) => {
    this.setState({ language: newLanguage })
    document.querySelector('html')?.setAttribute('lang', newLanguage)
  }

  setTheme = (newThemeName: string) => {
    configStore.set('theme', newThemeName)
    this.setState({ theme: newThemeName })
    window.setTheme(newThemeName)
  }

  zoomTimer: NodeJS.Timeout | undefined = undefined
  setZoomPercent = (newZoomPercent: number) => {
    if (this.zoomTimer) clearTimeout(this.zoomTimer)

    configStore.set('zoomPercent', newZoomPercent)
    this.setState({ zoomPercent: newZoomPercent })

    this.zoomTimer = setTimeout(() => {
      window.api.setZoomFactor((newZoomPercent / 100).toString())
    }, 500)
  }

  setPrimaryFontFamily = (newFontFamily: string, saveToFile = true) => {
    if (saveToFile) configStore.set('actionsFontFamily', newFontFamily)
    document.documentElement.style.setProperty(
      '--primary-font-family',
      newFontFamily
    )
  }

  setSecondaryFontFamily = (newFontFamily: string, saveToFile = true) => {
    if (saveToFile) configStore.set('contentFontFamily', newFontFamily)
    document.documentElement.style.setProperty(
      '--secondary-font-family',
      newFontFamily
    )
  }

  setAllTilesInColor = (value: boolean) => {
    configStore.set('allTilesInColor', value)
    this.setState({ allTilesInColor: value })
  }

  setTitlesAlwaysVisible = (value: boolean) => {
    configStore.set('titlesAlwaysVisible', value)
    this.setState({ titlesAlwaysVisible: value })
  }

  setDisableDialogBackdropClose = (value: boolean) => {
    configStore.set('disableDialogBackdropClose', value)
    this.setState({ disableDialogBackdropClose: value })
  }

  setDisableAnimations = (value: boolean) => {
    configStore.set('disableAnimations', value)
    this.setState({ disableAnimations: value })
  }

  setSideBarCollapsed = (value: boolean) => {
    this.setState({ sidebarCollapsed: value })
  }

  setHideChangelogsOnStartup = (value: boolean) => {
    this.setState({ hideChangelogsOnStartup: value })
  }

  setLastChangelogShown = (value: string) => {
    this.setState({ lastChangelogShown: value })
  }

  hideGame = (appNameToHide: string, appTitle: string) => {
    const newHiddenGames = [
      ...this.state.hiddenGames,
      { appName: appNameToHide, title: appTitle }
    ]

    this.setState({
      hiddenGames: newHiddenGames
    })
    configStore.set('games.hidden', newHiddenGames)
  }

  unhideGame = (appNameToUnhide: string) => {
    const newHiddenGames = this.state.hiddenGames.filter(
      ({ appName }) => appName !== appNameToUnhide
    )

    this.setState({
      hiddenGames: newHiddenGames
    })
    configStore.set('games.hidden', newHiddenGames)
  }

  addGameToFavourites = (appNameToAdd: string, appTitle: string) => {
    const newFavouriteGames = [
      ...this.state.favouriteGames.filter(
        (fav) => fav.appName !== appNameToAdd
      ),
      { appName: appNameToAdd, title: appTitle }
    ]

    this.setState({
      favouriteGames: newFavouriteGames
    })
    configStore.set('games.favourites', newFavouriteGames)
  }

  removeGameFromFavourites = (appNameToRemove: string) => {
    const newFavouriteGames = this.state.favouriteGames.filter(
      ({ appName }) => appName !== appNameToRemove
    )

    this.setState({
      favouriteGames: newFavouriteGames
    })
    configStore.set('games.favourites', newFavouriteGames)
  }

  getCustomCategories = () =>
    Array.from(new Set(Object.keys(this.state.customCategories))).sort()

  getCurrentCustomCategories = () =>
    Array.from(new Set(this.state.currentCustomCategories)).sort()

  setCustomCategory = (newCategory: string) => {
    const newCustomCategories = this.state.customCategories
    newCustomCategories[newCategory] = []

    // when adding a new category, if there are categories selected, select the new
    // one too so the game doesn't disappear form the library
    let newCurrentCustomCategories = this.state.currentCustomCategories
    if (this.state.currentCustomCategories.length > 0) {
      newCurrentCustomCategories = [...newCurrentCustomCategories, newCategory]
    }

    this.setState({
      customCategories: newCustomCategories,
      currentCustomCategories: newCurrentCustomCategories
    })
    configStore.set('games.customCategories', newCustomCategories)
  }

  removeCustomCategory = (category: string) => {
    if (!this.state.customCategories[category]) return

    const newCustomCategories = this.state.customCategories
    delete newCustomCategories[category]
    this.setState({ customCategories: { ...newCustomCategories } })

    const updatedCategories = this.getCurrentCustomCategories().filter(
      (cat) => cat !== category
    )
    this.setCurrentCustomCategories(updatedCategories)
    const numberOfCategories = updatedCategories.length

    if (numberOfCategories < 1) {
      this.setCurrentCustomCategories(['preset_uncategorized'])
    }
    configStore.set('games.customCategories', newCustomCategories)
  }

  renameCustomCategory = (oldName: string, newName: string) => {
    if (!this.state.customCategories[oldName]) return

    const newCustomCategories = this.state.customCategories
    newCustomCategories[newName] = newCustomCategories[oldName]
    delete newCustomCategories[oldName]

    this.setState({ customCategories: { ...newCustomCategories } })
    configStore.set('games.customCategories', newCustomCategories)

    const newCurrentCustomCategories = this.state.currentCustomCategories.map(
      (cat) => (cat === oldName ? newName : cat)
    )
    this.setCurrentCustomCategories(newCurrentCustomCategories)
  }

  addGameToCustomCategory = (category: string, appName: string) => {
    const gamesInCategory = this.state.customCategories[category] || []
    gamesInCategory.push(appName)

    const newCustomCategories = {
      ...this.state.customCategories,
      [category]: gamesInCategory
    }

    this.setState({
      customCategories: newCustomCategories
    })
    configStore.set('games.customCategories', newCustomCategories)
  }

  removeGameFromCustomCategory = (category: string, appName: string) => {
    if (!this.state.customCategories[category]) return

    const newCustomCategories: Record<string, string[]> = {}
    for (const [key, games] of Object.entries(this.state.customCategories)) {
      if (key === category)
        newCustomCategories[key] = games.filter((game) => game !== appName)
      else newCustomCategories[key] = this.state.customCategories[key]
    }

    this.setState({
      customCategories: newCustomCategories
    })
    configStore.set('games.customCategories', newCustomCategories)
  }

  handleShowDialogModal = ({
    showDialog = true,
    ...options
  }: DialogModalOptions) => {
    this.setState({
      dialogModalOptions: { showDialog, ...options }
    })
  }

  showResetDialog = (() => {
    this.handleShowDialogModal({
      title: t('box.reset-heroic.question.title', 'Reset Heroic'),
      message: t(
        'box.reset-heroic.question.message',
        "Are you sure you want to reset Heroic? This will remove all Settings and Caching but won't remove your Installed games or your Epic credentials. Portable versions (AppImage, WinPortable, ...) of Heroic needs to be restarted manually afterwards."
      ),
      buttons: [
        { text: t('box.yes'), onClick: window.api.resetHeroic },
        { text: t('box.no') }
      ]
    })
  }).bind(this)

  handleExternalLinkDialog = (value: ExternalLinkDialogOptions) => {
    this.setState({ externalLinkDialogOptions: value })
  }

  handleLibraryTopSection = (value: LibraryTopSectionOptions) => {
    this.setState({ libraryTopSection: value })
  }

  handleExperimentalFeatures = (value: ExperimentalFeatures) => {
    this.setState({
      experimentalFeatures: value,
      zoom: { ...this.state.zoom, enabled: value }
    })
  }

  handleSuccessfulLogin = (runner: Runner) => {
    storage.setItem('category', 'all')
    this.refreshLibrary({
      runInBackground: false,
      library: runner
    })
  }

  epicLogin = async (sid: string) => {
    console.log('logging epic')
    const response = await window.api.login(sid)

    if (response.status === 'done') {
      this.setState({
        epic: {
          library: [],
          username: response.data?.displayName
        }
      })

      this.handleSuccessfulLogin('legendary')
    }

    return response.status
  }

  epicLogout = async () => {
    this.setState({ refreshing: true })
    await window.api.logoutLegendary().finally(() => {
      this.setState({
        epic: {
          library: [],
          username: null
        }
      })
    })
    console.log('Logging out from epic')
    this.setState({ refreshing: false })
    window.location.reload()
  }

  gogLogin = async (token: string) => {
    console.log('logging gog')
    const response = await window.api.authGOG(token)

    if (response.status === 'done') {
      this.setState({
        gog: {
          library: [],
          username: response.data?.username
        }
      })

      this.handleSuccessfulLogin('gog')
    }

    return response.status
  }

  gogLogout = async () => {
    window.api.logoutGOG()
    this.setState({
      gog: {
        library: [],
        username: null
      }
    })
    console.log('Logging out from gog')
    window.location.reload()
  }

  amazonLogin = async (data: NileRegisterData) => {
    console.log('logging amazon')
    const response = await window.api.authAmazon(data)

    if (response.status === 'done') {
      this.setState({
        amazon: {
          library: [],
          user_id: response.user?.user_id,
          username: response.user?.name
        }
      })

      this.handleSuccessfulLogin('nile')
    }

    return response.status
  }

  amazonLogout = async () => {
    await window.api.logoutAmazon()
    this.setState({
      amazon: {
        library: [],
        user_id: null,
        username: null
      }
    })
    console.log('Logging out from amazon')
    window.location.reload()
  }

  getAmazonLoginData = async () => window.api.getAmazonLoginData()

  itchioLogin = async (data: ItchioRegisterData) => {
    console.log('logging itch.io')
    const response = await window.api.authItchio(data)

    if (response.status === 'done') {
      this.setState({
        itchio: {
          library: [],
          username: response.user?.username
        }
      })

      this.handleSuccessfulLogin('itchio')
    }

    return response.status
  }

  itchioLogout = async () => {
    await window.api.logoutItchio()
    this.setState({
      itchio: {
        library: [],
        username: null
      }
    })
    console.log('Logging out from itch.io')
    window.location.reload()
  }

  getItchioLoginData = async () => window.api.getItchioLoginData()

  zoomLogin = async (url: string) => {
    console.log('logging zoom')
    const response = await window.api.authZoom(url)

    if (response.status === 'done') {
      const userInfo = await window.api.getZoomUserInfo()
      this.setState({
        zoom: {
          library: [],
          username: userInfo?.username,
          enabled: true
        }
      })

      this.handleSuccessfulLogin('zoom')
    }

    return response.status
  }

  zoomLogout = async () => {
    window.api.logoutZoom()
    this.setState({
      zoom: {
        library: [],
        username: null,
        enabled: true
      }
    })
    console.log('Logging out from zoom')
    window.location.reload()
  }

  refresh = async (
    library?: Runner | 'all',
    checkUpdates = false
  ): Promise<void> => {
    console.log('refreshing')

    const { epic, gog, amazon, zoom, itchio, gameUpdates } = this.state

    let updates = gameUpdates
    if (checkUpdates) {
      try {
        updates = await window.api.checkGameUpdates()
      } catch (error) {
        window.api.logError(`${error}`)
      }
    }

    const currentLibraryLength = epic.library?.length

    let epicLibrary = libraryStore.get('library', [])
    if (epic.username && (!epicLibrary.length || !epic.library.length)) {
      window.api.logInfo('No cache found, getting data from legendary...')
      const { library: legendaryLibrary } = await getLegendaryConfig()
      epicLibrary = legendaryLibrary
    }

    let gogLibrary = this.loadGOGLibrary()
    if (gog.username && (!gogLibrary.length || !gog.library.length)) {
      window.api.logInfo('No cache found, getting data from gog...')
      await window.api.refreshLibrary('gog')
      gogLibrary = this.loadGOGLibrary()
    }

    let zoomLibrary: GameInfo[] = []
    if (zoom.enabled) {
      zoomLibrary = this.loadZoomLibrary()
      if (zoom.username && (!zoomLibrary.length || !zoom.library.length)) {
        window.api.logInfo('No cache found, getting data from zoom...')
        await window.api.refreshLibrary('zoom')
        zoomLibrary = this.loadZoomLibrary()
      }
    }

    let amazonLibrary = nileLibraryStore.get('library', [])
    if (amazon.user_id && (!amazonLibrary.length || !amazon.library.length)) {
      window.api.logInfo('No cache found, getting data from nile...')
      await window.api.refreshLibrary('nile')
      amazonLibrary = this.loadAmazonLibrary()
    }

    let itchioLibrary = this.loadItchioLibrary()
    if (itchio.username && (!itchioLibrary.length || !itchio.library.length)) {
      window.api.logInfo('No cache found, getting data from itch.io...')
      await window.api.refreshLibrary('itchio')
      itchioLibrary = this.loadItchioLibrary()
    }

    const updatedSideload = sideloadLibrary.get('games', [])

    this.setState({
      epic: {
        library: epicLibrary,
        username: epic.username
      },
      gog: {
        library: gogLibrary,
        username: gog.username
      },
      zoom: {
        library: zoomLibrary,
        username: zoom.username,
        enabled: zoom.enabled
      },
      amazon: {
        library: amazonLibrary,
        user_id: amazon.user_id,
        username: amazon.username
      },
      itchio: {
        library: itchioLibrary,
        username: itchio.username
      },
      gameUpdates: updates,
      refreshing: false,
      refreshingInTheBackground: true,
      sideloadedLibrary: updatedSideload
    })

    if (currentLibraryLength !== epicLibrary.length) {
      window.api.logInfo('Force Update')
      this.forceUpdate()
    }
  }

  refreshLibrary = async ({
    checkForUpdates,
    runInBackground = true,
    library = undefined
  }: RefreshOptions): Promise<void> => {
    if (this.state.refreshing) return

    this.setState({
      refreshing: true,
      refreshingInTheBackground: runInBackground
    })
    window.api.logInfo(`Refreshing ${library} Library`)
    try {
      await window.api.refreshLibrary(library)
      return await this.refresh(library, checkForUpdates)
    } catch (error) {
      window.api.logError(`${error}`)
    }
  }

  handleGameStatus = async ({
    appName,
    status,
    folder,
    context,
    progress,
    runner
  }: GameStatus) => {
    const { libraryStatus, gameUpdates } = this.state
    const currentApp = libraryStatus.find((game) => game.appName === appName)

    // add app to libraryStatus if it was not present
    if (!currentApp) {
      return this.setState({
        libraryStatus: [
          ...libraryStatus,
          { appName, status, folder, context, progress, runner }
        ]
      })
    }

    // if the app's status didn't change, do nothing
    if (currentApp.status === status && currentApp.context === context) {
      return
    }

    // if the app's status did change, remove it from the current list and then handle the new status
    const newLibraryStatus = libraryStatus.filter(
      (game) => game.appName !== appName
    )

    // in these cases we just add the new status
    if (
      [
        'installing',
        'updating',
        'playing',
        'extracting',
        'launching',
        'winetricks',
        'redist',
        'queued'
      ].includes(status)
    ) {
      newLibraryStatus.push({
        appName,
        status,
        folder,
        context,
        progress,
        runner
      })
      this.setState({ libraryStatus: newLibraryStatus })
    }

    // when error or done we remove it from the status info
    if (['error', 'done'].includes(status)) {
      // also remove from updates if it was updating
      if (currentApp.status === 'updating') {
        const updatedGamesUpdates = gameUpdates.filter(
          (game) => game !== appName
        )
        // This avoids calling legendary again before the previous process is killed when canceling
        this.refreshLibrary({
          checkForUpdates: true,
          runInBackground: true,
          library: runner
        })

        storage.setItem('updates', JSON.stringify(updatedGamesUpdates))
        return this.setState({
          gameUpdates: updatedGamesUpdates,
          libraryStatus: newLibraryStatus
        })
      }

      this.refreshLibrary({ runInBackground: true, library: runner })

      this.setState({ libraryStatus: newLibraryStatus })
    }
  }

  async componentDidMount() {
    const {
      epic,
      gog,
      amazon,
      zoom,
      gameUpdates = [],
      libraryStatus,
      platform
    } = this.state

    window.api.handleInstallGame(async (e, appName, runner) => {
      const currentApp = libraryStatus.filter(
        (game) => game.appName === appName
      )[0]
      if (!currentApp || (currentApp && currentApp.status !== 'installing')) {
        const gameInfo = await getGameInfo(appName, runner)
        if (!gameInfo || gameInfo.runner === 'sideload') {
          return
        }
        return this.setState({
          showInstallModal: {
            show: true,
            appName,
            runner,
            gameInfo
          }
        })
      }
    })

    window.api.handleGameStatus((e, args) => {
      this.handleGameStatus({ ...args })
    })

    window.api.handleRefreshLibrary((e, runner) => {
      this.refreshLibrary({
        checkForUpdates: false,
        runInBackground: true,
        library: runner
      })
    })

    window.api.handleGamePush((e: IpcRendererEvent, args: GameInfo) => {
      if (!args.app_name) return
      if (args.runner === 'gog') {
        const library = [...this.state.gog.library]
        const index = library.findIndex(
          (game) => game.app_name === args.app_name
        )
        if (index !== -1) {
          library[index] = args
        } else {
          library.push(args)
        }
        this.setState({
          gog: {
            library: [...library],
            username: this.state.gog.username
          }
        })
      } else if (args.runner === 'zoom') {
        // Handle Zoom game push
        const library = [...this.state.zoom.library]
        const index = library.findIndex(
          (game) => game.app_name === args.app_name
        )
        if (index !== -1) {
          library[index] = args
        } else {
          library.push(args)
        }
        this.setState({
          zoom: {
            library: [...library],
            username: this.state.zoom.username,
            enabled: true
          }
        })
      } else if (args.runner === 'itchio') {
        const library = [...this.state.itchio.library]
        const index = library.findIndex(
          (game) => game.app_name === args.app_name
        )
        if (index !== -1) {
          library[index] = args
        } else {
          library.push(args)
        }
        this.setState({
          itchio: {
            ...this.state.itchio,
            library
          }
        })
      }
    })

    if (platform === 'darwin') {
      this.setState({ isIntelMac: await window.api.isIntelMac() })
    }

    this.setState({
      isFullscreen: await window.api.isFullscreen(),
      isFrameless: await window.api.isFrameless()
    })
    window.api.handleFullscreen(
      (e: IpcRendererEvent, isFullscreen: boolean) => {
        this.setState({ isFullscreen })
      }
    )

    const legendaryUser = configStore.has('userInfo')
    const gogUser = gogConfigStore.has('userData')
    const amazonUser = nileConfigStore.has('userData')
    const zoomUser = zoomConfigStore.has('isLoggedIn')
    const itchioUser = itchioConfigStore.has('userData')

    if (legendaryUser) {
      await window.api.getUserInfo()
    }

    if (amazonUser) {
      await window.api.getAmazonUserInfo()
    }

    if (zoom.enabled && zoomUser) {
      await window.api.getZoomUserInfo()
    }

    if (itchioUser) {
      // Re-establish butlerd session and refresh cached profile data
      await window.api.getItchioUserInfo()
    }

    if (!gameUpdates.length) {
      const storedGameUpdates = JSON.parse(storage.getItem('updates') || '[]')
      this.setState({ gameUpdates: storedGameUpdates })
    }

    if (
      legendaryUser ||
      gogUser ||
      amazonUser ||
      (zoom.enabled && zoomUser) ||
      itchioUser
    ) {
      this.refreshLibrary({
        checkForUpdates: true,
        runInBackground:
          epic.library.length !== 0 ||
          gog.library.length !== 0 ||
          amazon.library.length !== 0 ||
          ((this.state.zoom.enabled && zoom.library) || []).length !== 0
      })
    }

    window.addEventListener(
      'controller-changed',
      (e: CustomEvent<{ controllerId: string }>) => {
        document.body.classList.toggle(
          'controllerLayout',
          e.detail.controllerId !== ''
        )
        this.setState({ activeController: e.detail.controllerId })
      }
    )

    // listen to custom connectivity-changed event to update state
    window.api.onConnectivityChanged((_, connectivity) => {
      this.setState({ connectivity })
    })

    // get the current status
    window.api
      .getConnectivityStatus()
      .then((connectivity) => this.setState({ connectivity }))

    this.setPrimaryFontFamily(this.state.primaryFontFamily, false)
    this.setSecondaryFontFamily(this.state.secondaryFontFamily, false)

    window.api.frontendReady()
  }

  componentDidUpdate() {
    const {
      gameUpdates,
      libraryStatus,
      sidebarCollapsed,
      hideChangelogsOnStartup,
      lastChangelogShown,
      language
    } = this.state

    const isRTL = RTL_LANGUAGES.includes(language)
    document.body.classList.toggle('isRTL', isRTL)

    storage.setItem('updates', JSON.stringify(gameUpdates))
    storage.setItem('sidebar_collapsed', JSON.stringify(sidebarCollapsed))
    storage.setItem('hide_changelogs', JSON.stringify(hideChangelogsOnStartup))
    storage.setItem('last_changelog', JSON.stringify(lastChangelogShown))

    const allowedPendingOps: Status[] = [
      'installing',
      'updating',
      'launching',
      'playing',
      'redist',
      'winetricks',
      'extracting',
      'repairing',
      'moving',
      'syncing-saves',
      'uninstalling'
    ]

    const pendingOps = libraryStatus.filter((game) =>
      allowedPendingOps.includes(game.status)
    ).length
    const playing =
      libraryStatus.filter((game) => game.status === 'playing').length > 0

    if (pendingOps) {
      window.api.lock(playing)
    } else {
      window.api.unlock()
    }
  }

  addHelpItem = (helpItemId: string, helpItem: HelpItem) => {
    this.setState((previous: StateProps) => {
      const newItems = { ...previous.helpItems }
      newItems[helpItemId] = helpItem
      return { helpItems: newItems }
    })
  }

  removeHelpItem = (helpItemId: string) => {
    this.setState((previous: StateProps) => {
      delete previous.helpItems[helpItemId]
      return { helpItems: { ...previous.helpItems } }
    })
  }

  render() {
    const {
      language,
      epic,
      gog,
      amazon,
      zoom,
      itchio,
      favouriteGames,
      customCategories,
      hiddenGames,
      hideChangelogsOnStartup,
      lastChangelogShown,
      libraryStatus
    } = this.state
    const isRTL = RTL_LANGUAGES.includes(language)

    const installingEpicGame = libraryStatus.some(
      (game) => game.status === 'installing' && game.runner === 'legendary'
    )

    return (
      <ContextProvider.Provider
        value={{
          ...this.state,
          epic: {
            library: epic.library,
            username: epic.username,
            login: this.epicLogin,
            logout: this.epicLogout
          },
          gog: {
            library: gog.library,
            username: gog.username,
            login: this.gogLogin,
            logout: this.gogLogout
          },
          amazon: {
            library: amazon.library,
            user_id: amazon.user_id,
            username: amazon.username,
            getLoginData: this.getAmazonLoginData,
            login: this.amazonLogin,
            logout: this.amazonLogout
          },
          zoom: {
            library: this.state.zoom.enabled ? zoom.library : [],
            username: this.state.zoom.enabled ? zoom.username : undefined,
            login: this.zoomLogin,
            logout: this.zoomLogout,
            enabled: this.state.zoom.enabled
          },
          itchio: {
            library: itchio.library,
            username: itchio.username,
            getLoginData: this.getItchioLoginData,
            login: this.itchioLogin,
            logout: this.itchioLogout
          },
          installingEpicGame,
          setLanguage: this.setLanguage,
          isRTL,
          refresh: this.refresh,
          refreshLibrary: this.refreshLibrary,
          hiddenGames: {
            list: hiddenGames,
            add: this.hideGame,
            remove: this.unhideGame
          },
          favouriteGames: {
            list: favouriteGames,
            add: this.addGameToFavourites,
            remove: this.removeGameFromFavourites
          },
          customCategories: {
            list: customCategories,
            listCategories: this.getCustomCategories,
            addToGame: this.addGameToCustomCategory,
            removeFromGame: this.removeGameFromCustomCategory,
            addCategory: this.setCustomCategory,
            removeCategory: this.removeCustomCategory,
            renameCategory: this.renameCustomCategory
          },
          handleLibraryTopSection: this.handleLibraryTopSection,
          handleExperimentalFeatures: this.handleExperimentalFeatures,
          setTheme: this.setTheme,
          setZoomPercent: this.setZoomPercent,
          setAllTilesInColor: this.setAllTilesInColor,
          setTitlesAlwaysVisible: this.setTitlesAlwaysVisible,
          setSideBarCollapsed: this.setSideBarCollapsed,
          setPrimaryFontFamily: this.setPrimaryFontFamily,
          setSecondaryFontFamily: this.setSecondaryFontFamily,
          showDialogModal: this.handleShowDialogModal,
          showResetDialog: this.showResetDialog,
          handleExternalLinkDialog: this.handleExternalLinkDialog,
          hideChangelogsOnStartup: hideChangelogsOnStartup,
          setHideChangelogsOnStartup: this.setHideChangelogsOnStartup,
          lastChangelogShown: lastChangelogShown,
          setLastChangelogShown: this.setLastChangelogShown,
          setCurrentCustomCategories: this.setCurrentCustomCategories,
          help: {
            items: this.state.helpItems,
            addHelpItem: this.addHelpItem,
            removeHelpItem: this.removeHelpItem
          },
          setDisableDialogBackdropClose: this.setDisableDialogBackdropClose,
          disableAnimations: this.state.disableAnimations,
          setDisableAnimations: this.setDisableAnimations
        }}
      >
        {this.props.children}
      </ContextProvider.Provider>
    )
  }
}

export default withTranslation()(GlobalState)
