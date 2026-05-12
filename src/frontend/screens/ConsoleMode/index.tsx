import './index.scss'

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'

import ContextProvider from 'frontend/state/ContextProvider'
import { getImageFormatting } from '../Library/components/GameCard/constants'
import { CachedImage } from 'frontend/components/UI'
import fallBackImage from 'frontend/assets/heroic_card.jpg'
import HeroicIcon from 'frontend/assets/heroic-icon.svg?react'

import ControllerHints from './components/ControllerHints'
import LaunchOverlay from './components/LaunchOverlay'
import InstallOverlay from './InstallOverlay'
import UpdateNotice from './components/UpdateNotice'
import { BTN_L1, BTN_R1, BTN_R2 } from './controller'
import { useColumnCount, useGamepadButtonPress, useGamepadInfo } from './hooks'

import type { GameInfo, Runner, Status } from 'common/types'

type StoreKey = Runner | 'all'

export default function ConsoleMode() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const {
    epic,
    gog,
    amazon,
    zoom,
    itchio,
    libraryStatus,
    sideloadedLibrary,
    refreshLibrary,
    refreshing,
    gameUpdates
  } = useContext(ContextProvider)

  const [activeStore, setActiveStore] = useState<StoreKey>('all')
  const [ascending, setAscending] = useState(true)
  const [filteringByInstalled, setFilteringByInstalled] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [launchingGame, setLaunchingGame] = useState<GameInfo | null>(null)
  const [installingGame, setInstallingGame] = useState<GameInfo | null>(null)
  const [updateNoticeGame, setUpdateNoticeGame] = useState<GameInfo | null>(
    null
  )

  const { connected: gamepadConnected, layout: controllerLayout } =
    useGamepadInfo()

  const cardRefs = useRef<Array<HTMLButtonElement | null>>([])
  const gridRef = useRef<HTMLDivElement | null>(null)
  const topBarRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    window.api.setFullscreen(true)
    if (
      !refreshing &&
      epic.library.length === 0 &&
      gog.library.length === 0 &&
      amazon.library.length === 0 &&
      zoom.library.length === 0 &&
      itchio.library.length === 0
    ) {
      void refreshLibrary({ runInBackground: true })
    }
    return () => {
      window.api.setFullscreen(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const allGames = useMemo<GameInfo[]>(() => {
    const all: GameInfo[] = [
      ...epic.library,
      ...gog.library,
      ...amazon.library,
      ...zoom.library,
      ...itchio.library,
      ...sideloadedLibrary
    ]
    return all.filter((g) => !g.install?.is_dlc && !g.thirdPartyManagedApp)
  }, [
    epic.library,
    gog.library,
    amazon.library,
    zoom.library,
    itchio.library,
    sideloadedLibrary
  ])

  const visibleGames = useMemo(() => {
    // reset card refs to rebuild them
    cardRefs.current = []

    let filteredGames = allGames

    if (filteringByInstalled) {
      filteredGames = filteredGames.filter((g) => g.is_installed)
    }

    if (activeStore !== 'all') {
      filteredGames = filteredGames.filter((g) => g.runner === activeStore)
    }

    return filteredGames.sort((a, b) => {
      const cmp = a.title.localeCompare(b.title)
      return ascending ? cmp : -cmp
    })
  }, [allGames, filteringByInstalled, activeStore, ascending])

  const storesWithGames = useMemo(() => {
    const set = new Set<Runner>()
    for (const g of allGames) set.add(g.runner)
    return set
  }, [allGames])

  const storeFilters = useMemo<
    { key: StoreKey; label: string; enabled: boolean }[]
  >(
    () => [
      {
        key: 'all',
        label: t('console.filter.all', 'All'),
        enabled: allGames.length > 0
      },
      {
        key: 'legendary',
        label: 'Epic',
        enabled: storesWithGames.has('legendary')
      },
      { key: 'gog', label: 'GOG', enabled: storesWithGames.has('gog') },
      { key: 'nile', label: 'Amazon', enabled: storesWithGames.has('nile') },
      {
        key: 'sideload',
        label: t('console.filter.sideload', 'Other'),
        enabled: storesWithGames.has('sideload')
      },
      { key: 'zoom', label: 'ZOOM', enabled: storesWithGames.has('zoom') },
      {
        key: 'itchio',
        label: 'itch.io',
        enabled: storesWithGames.has('itchio')
      }
    ],
    [t, storesWithGames, allGames.length]
  )

  const enabledStoreKeys = useMemo(
    () => storeFilters.filter((f) => f.enabled).map((f) => f.key),
    [storeFilters]
  )

  useEffect(() => {
    if (activeStore !== 'all' && !enabledStoreKeys.includes(activeStore)) {
      setActiveStore('all')
    }
  }, [enabledStoreKeys, activeStore])

  const columns = useColumnCount(cardRefs, visibleGames.length)

  useEffect(() => {
    // always make sane focused index
    if (focusedIndex >= visibleGames.length || focusedIndex < 0) {
      setFocusedIndex(
        Math.max(0, Math.min(focusedIndex, visibleGames.length - 1))
      )
    }
  }, [visibleGames.length, focusedIndex])

  useEffect(() => {
    const btn = cardRefs.current[focusedIndex]
    if (!btn) return
    if (document.activeElement !== btn) {
      btn.focus({ preventScroll: true })
    }
    btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focusedIndex, visibleGames.length])

  const cycleStore = useCallback(
    (direction: 1 | -1) => {
      if (enabledStoreKeys.length === 0) return
      const idx = enabledStoreKeys.indexOf(activeStore)
      const next =
        (idx + direction + enabledStoreKeys.length) % enabledStoreKeys.length
      setActiveStore(enabledStoreKeys[next])
    },
    [enabledStoreKeys, activeStore]
  )

  const quit = useCallback(() => navigate('/'), [navigate])

  const onTopBarKeyDown = (e: React.KeyboardEvent) => {
    if (launchingGame || updateNoticeGame) return
    const root = topBarRef.current
    if (!root) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      cardRefs.current[focusedIndex]?.focus()
      return
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const btns = Array.from(
        root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
      )
      const active = document.activeElement as HTMLButtonElement | null
      const idx = active ? btns.indexOf(active) : -1
      if (idx === -1 || btns.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      const delta = e.key === 'ArrowRight' ? 1 : -1
      const next = (idx + delta + btns.length) % btns.length
      btns[next].focus()
    }
  }

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    if (visibleGames.length === 0 || launchingGame || updateNoticeGame) return
    const last = visibleGames.length - 1

    if (e.key === 'ArrowRight') {
      e.preventDefault()
      e.stopPropagation()
      setFocusedIndex((i) => Math.min(i + 1, last))
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      e.stopPropagation()
      setFocusedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      setFocusedIndex((i) => Math.min(i + columns, last))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      if (focusedIndex < columns) {
        const first = topBarRef.current?.querySelector<HTMLButtonElement>(
          'button:not(:disabled)'
        )
        first?.focus()
      } else {
        setFocusedIndex((i) => Math.max(i - columns, 0))
      }
    }
  }

  // Read by gamepad.ts to block the Guide/back buttons during launch.
  useEffect(() => {
    if (!launchingGame) return
    document.body.classList.add('console-launching')
    return () => document.body.classList.remove('console-launching')
  }, [launchingGame])

  const idle = !launchingGame && !updateNoticeGame
  const toggleSort = useCallback(() => setAscending((v) => !v), [])

  useGamepadButtonPress(BTN_L1, () => cycleStore(-1), idle)
  useGamepadButtonPress(BTN_R1, () => cycleStore(1), idle)
  useGamepadButtonPress(BTN_R2, toggleSort, idle)

  return (
    <div className={classNames('ConsoleMode', { launching: !!launchingGame })}>
      <div
        className="consoleTopBar"
        ref={topBarRef}
        onKeyDown={onTopBarKeyDown}
      >
        <HeroicIcon className="consoleLogo" />
        <div className="consoleFilters">
          <button
            key={'installedGames'}
            className={classNames('consoleChip', {
              active: filteringByInstalled
            })}
            onClick={() => setFilteringByInstalled(!filteringByInstalled)}
          >
            {t('status.installed', 'Installed')}
          </button>
          <div className="consoleDividerVertical" />
          {storeFilters
            .filter((f) => f.enabled)
            .map((f) => (
              <button
                key={f.key}
                className={classNames('consoleChip', {
                  active: activeStore === f.key
                })}
                onClick={() => setActiveStore(f.key)}
                disabled={!!launchingGame}
              >
                {f.label}
              </button>
            ))}
        </div>
        <div className="consoleTopRight">
          <button
            className="consoleChip"
            onClick={toggleSort}
            aria-label={t('console.sort', 'Sort')}
            disabled={!!launchingGame}
          >
            {ascending ? 'A → Z' : 'Z → A'}
          </button>
          <button
            className="consoleQuitButton"
            onClick={quit}
            disabled={!!launchingGame}
          >
            {t('console.quit', 'Quit Console')}
          </button>
          <button
            className="consoleQuitButton danger"
            onClick={() => window.api.quit()}
            disabled={!!launchingGame}
          >
            {t('console.quitApp', 'Quit App')}
          </button>
        </div>
      </div>

      <div className="consoleTitleBar">
        {visibleGames[focusedIndex] && (
          <h1 className="consoleFocusTitle">
            {visibleGames[focusedIndex].title}
          </h1>
        )}
      </div>

      <div className="consoleStage">
        {visibleGames.length === 0 ? (
          <div className="consoleEmpty">
            {refreshing
              ? t('console.loading', 'Loading your library…')
              : t(
                  'console.empty',
                  'No installed games to show. Install something first.'
                )}
          </div>
        ) : (
          <div
            className="consoleGridScroller"
            ref={gridRef}
            role="listbox"
            aria-label={t('console.games', 'Installed games')}
            onKeyDown={onGridKeyDown}
          >
            <div className="consoleGrid">
              {visibleGames.map((game, i) => {
                const isFocused = i === focusedIndex
                const needsUpdate = gameUpdates.includes(game.app_name)
                // badges we want to show status updates on
                const badgeStates: Status[] = [
                  'installing',
                  'queued',
                  'updating',
                  'uninstalling'
                ]

                const gameStatus = libraryStatus.find(
                  (st) => st.appName === game.app_name
                )

                return (
                  <button
                    key={`${game.runner}-${game.app_name}`}
                    ref={(el) => {
                      cardRefs.current[i] = el
                    }}
                    className={classNames('consoleCard', {
                      focused: isFocused
                    })}
                    tabIndex={isFocused ? 0 : -1}
                    onClick={() => {
                      if (isFocused) {
                        if (gameUpdates.includes(game.app_name)) {
                          setUpdateNoticeGame(game)
                        } else if (game.is_installed) setLaunchingGame(game)
                        else setInstallingGame(game)
                      } else setFocusedIndex(i)
                    }}
                    onMouseEnter={() => setFocusedIndex(i)}
                    onFocus={() => setFocusedIndex(i)}
                  >
                    <CachedImage
                      src={
                        getImageFormatting(game.art_square, game.runner) ||
                        fallBackImage
                      }
                      alt={game.title}
                      className="consoleCardArt"
                    />
                    {needsUpdate && (
                      <span className="consoleCardBadge">
                        {t('console.card.needsUpdate', 'Needs update')}
                      </span>
                    )}
                    {gameStatus?.status &&
                      badgeStates.includes(gameStatus?.status) && (
                        <span className="consoleCardBadge">
                          {t(
                            `gamepage:status.${gameStatus?.status}`,
                            'Installing'
                          )}
                        </span>
                      )}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="consoleFooter">
        {gamepadConnected && !launchingGame && (
          <ControllerHints layout={controllerLayout} />
        )}
      </div>

      {launchingGame && (
        <LaunchOverlay
          game={launchingGame}
          onDismiss={() => setLaunchingGame(null)}
        />
      )}

      {installingGame && (
        <InstallOverlay
          game={installingGame}
          onDismiss={() => setInstallingGame(null)}
        />
      )}

      {updateNoticeGame && (
        <UpdateNotice
          game={updateNoticeGame}
          onDismiss={() => setUpdateNoticeGame(null)}
        />
      )}
    </div>
  )
}
