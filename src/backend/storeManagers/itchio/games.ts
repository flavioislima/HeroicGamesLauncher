import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync
} from 'graceful-fs'
import { basename, join } from 'path'

import {
  ExecResult,
  ExtraInfo,
  GameInfo,
  GameSettings,
  InstallArgs,
  InstallPlatform,
  LaunchOption
} from 'common/types'
import { InstallResult, RemoveArgs } from 'common/types/game_manager'
import type LogWriter from 'backend/logger/log_writer'
import { dialog } from 'electron'
import i18next from 'i18next'

import {
  LogPrefix,
  createGameLogWriter,
  logError,
  logInfo,
  logWarning
} from 'backend/logger'
import { GameConfig } from 'backend/game_config'
import {
  killPattern,
  removeSpecialcharacters,
  sendProgressUpdate,
  shutdownWine
} from 'backend/utils'
import { sendFrontendMessage } from '../../ipc'
import { launchGame } from 'backend/storeManagers/storeManagerCommon/games'
import { isLinux, isMac, isWindows } from 'backend/constants/environment'
import { getMainWindow } from 'backend/main_window'

import { getClient } from './butlerd'
import { installStore } from './electronStores'
import {
  butlerdPlatformKey,
  gameIdFromAppName,
  getGameInfo as getItchioLibraryGameInfo,
  getInstallInfo as getItchioLibraryInstallInfo,
  getStrictInstallInfo,
  installState as setLibraryInstallState
} from './library'
import { ItchioInstallInfo, ItchioUpload } from 'common/types/itchio'

const NOT_IMPLEMENTED =
  'itch.io integration: butlerd command not yet implemented'

function logNotImplemented(operation: string, details: object): void {
  logWarning(
    [`${NOT_IMPLEMENTED} (operation=${operation})`, details],
    LogPrefix.Itchio
  )
}

interface InstallQueueResult {
  id: string
  installFolder: string
  stagingFolder: string
  caveId: string
}

interface ButlerdVerdictCandidate {
  path: string
  size?: number
  // butlerd flavor: 'linux'|'macos'|'windows'|'love'|'jar'|'html'|'script'|...
  flavor?: string
  arch?: string
}

interface ButlerdVerdict {
  basePath?: string
  candidates?: ButlerdVerdictCandidate[]
}

interface ButlerdCave {
  id: string
  game?: { id?: number }
  upload?: ItchioUpload
  installInfo?: {
    installFolder?: string
    installedSize?: number
    verdict?: ButlerdVerdict
  }
}

interface FetchCaveResult {
  cave?: ButlerdCave
}

interface ButlerdProgress {
  progress?: number
  eta?: number
  bps?: number
}

interface InstallLocation {
  id: string
  path: string
}

interface InstallLocationsListResult {
  installLocations: InstallLocation[]
}

interface InstallLocationsAddResult {
  installLocation: InstallLocation
}

interface FetchCavesResult {
  items: ButlerdCave[]
  nextCursor?: string
}

// butlerd retains caves across Heroic restarts, so a previous uninstall
// from Heroic's UI may leave a cave behind that makes a fresh
// Install.Queue fail with "That upload is already installed!".
async function clearStaleCavesForGame(gameId: number): Promise<void> {
  const client = await getClient()
  try {
    const result = await client.call<FetchCavesResult>('Fetch.Caves', {
      filters: { gameId }
    })
    await Promise.all(
      (result.items ?? []).map(async (cave) => {
        try {
          await client.call('Uninstall.Perform', {
            caveId: cave.id,
            hard: true
          })
          logInfo(
            `itch.io: cleared stale cave ${cave.id} for game ${gameId}`,
            LogPrefix.Itchio
          )
        } catch (err) {
          logWarning(
            [
              `itch.io: failed to clear stale cave ${cave.id}:`,
              (err as Error).message
            ],
            LogPrefix.Itchio
          )
        }
      })
    )
  } catch (err) {
    logWarning(
      ['itch.io: Fetch.Caves failed:', (err as Error).message],
      LogPrefix.Itchio
    )
  }
}

// `.app` is a directory; spawn() needs the inner Mach-O at
// Contents/MacOS/<bin>. Returns the largest executable-bit file there
// (helpers are usually small).
function resolveAppBundleExecutable(
  appBundlePath: string
): { path: string; size: number } | undefined {
  const macOsDir = join(appBundlePath, 'Contents', 'MacOS')
  let entries: string[]
  try {
    entries = readdirSync(macOsDir)
  } catch {
    return undefined
  }
  let best: { path: string; size: number } | undefined
  for (const name of entries) {
    if (name.startsWith('.')) continue
    const full = join(macOsDir, name)
    try {
      const s = statSync(full)
      if (!s.isFile() || (s.mode & 0o111) === 0) continue
      if (!best || s.size > best.size) best = { path: full, size: s.size }
    } catch {
      /* ignore */
    }
  }
  return best
}

// Non-game Windows exes commonly shipped alongside the actual binary.
// Catches Unity (UnityCrashHandler64.exe), Unreal (CrashReportClient.exe),
// Chromium (crashpad_handler.exe), generic *crash_report* variants, and
// installers/uninstallers. Without this, size-sorted picks can land on
// the crash handler instead of the game.
const WINDOWS_AUX_EXE_RE = /uninst|crash(.?report|handler|pad)|setup/i

// Matches installer-style names. Used at launch time to detect cases where
// the chosen executable IS the installer (e.g. the itch.io upload ships
// an installer rather than a ready-to-run game), so we can warn the user
// and pass silent-install args. We deliberately do NOT require a word
// boundary before the keyword — itch.io devs commonly concatenate the
// game title with "Installer" (e.g. OctodadInstallerV1.5.3.exe).
const WINDOWS_INSTALLER_EXE_RE = /(setup|install)/i
const WINDOWS_UNINSTALLER_RE = /uninst/i

function isLikelyWindowsInstaller(executablePath: string): boolean {
  const name = basename(executablePath).toLowerCase()
  if (!name.endsWith('.exe')) return false
  if (WINDOWS_UNINSTALLER_RE.test(name)) return false
  return WINDOWS_INSTALLER_EXE_RE.test(name)
}

// Walked only when butlerd's verdict is empty.
function scanForExecutable(
  folder: string,
  platform: InstallPlatform
): string | undefined {
  if (!folder || !existsSync(folder)) return undefined
  type Hit = { path: string; size: number }
  const hits: Hit[] = []
  const key = butlerdPlatformKey(platform)

  const walk = (dir: string, depth: number): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const full = join(dir, name)
      let s: ReturnType<typeof statSync>
      try {
        s = statSync(full)
      } catch {
        continue
      }
      if (s.isDirectory()) {
        if (key === 'osx' && name.endsWith('.app')) {
          const inner = resolveAppBundleExecutable(full)
          if (inner) hits.push(inner)
          continue
        }
        if (depth < 4) walk(full, depth + 1)
        continue
      }
      if (key === 'windows' && name.toLowerCase().endsWith('.exe')) {
        if (WINDOWS_AUX_EXE_RE.test(name)) continue
        hits.push({ path: full, size: s.size })
      } else if (key === 'linux') {
        if (name.startsWith('.')) continue
        if ((s.mode & 0o111) !== 0) hits.push({ path: full, size: s.size })
      }
    }
  }

  walk(folder, 0)
  if (hits.length === 0) return undefined
  hits.sort((a, b) => b.size - a.size)
  return hits[0].path
}

// Lowercase, GOG-style: matches what `handleRunnersPlatforms` in
// `frontend/helpers/index.ts` produces, so install.platform round-trips
// cleanly through the frontend on later page opens.
const PLATFORM_BY_KEY: Record<'osx' | 'linux' | 'windows', InstallPlatform> = {
  osx: 'osx',
  linux: 'linux',
  windows: 'windows'
}

function uploadInstalledPlatform(
  upload: ItchioUpload | undefined,
  requested: InstallPlatform
): InstallPlatform {
  if (upload?.platforms?.osx) return PLATFORM_BY_KEY.osx
  if (upload?.platforms?.linux) return PLATFORM_BY_KEY.linux
  if (upload?.platforms?.windows) return PLATFORM_BY_KEY.windows
  return PLATFORM_BY_KEY[butlerdPlatformKey(requested) ?? 'windows']
}

const FLAVOR_BY_KEY: Record<'osx' | 'linux' | 'windows', string> = {
  osx: 'macos',
  linux: 'linux',
  windows: 'windows'
}

function pickLaunchCandidate(
  verdict: ButlerdVerdict | undefined,
  platform: InstallPlatform
): ButlerdVerdictCandidate | undefined {
  const candidates = verdict?.candidates ?? []
  if (candidates.length === 0) return undefined
  const desiredFlavor = FLAVOR_BY_KEY[butlerdPlatformKey(platform) ?? 'windows']
  const native = candidates.filter((c) => c.flavor === desiredFlavor)
  const pool = native.length ? native : candidates
  // On Windows, butlerd can return e.g. UnityCrashHandler64.exe as the
  // largest candidate. Strip those out, but fall back to the unfiltered
  // pool if filtering would leave nothing to launch.
  const filtered =
    butlerdPlatformKey(platform) === 'windows'
      ? pool.filter((c) => !WINDOWS_AUX_EXE_RE.test(basename(c.path)))
      : pool
  const finalPool = filtered.length ? filtered : pool
  return finalPool.slice().sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0]
}

// Create a wrapper folder named after the game inside the user-chosen
// install root, then register that wrapper with butlerd as its install
// location. butlerd will create its own `game-<id>` subfolder inside,
// keeping its cave path stable (so updates keep working) while the
// user sees "Game Name/" in their file manager. On collision (existing
// directory with the same sanitised name) we suffix `(2)`, `(3)`…
function ensureGameWrapperFolder(
  parent: string,
  title: string,
  appName: string
): string {
  const sanitised = removeSpecialcharacters(title).trim()
  const base = sanitised || appName
  let wrapper = join(parent, base)
  let n = 2
  while (existsSync(wrapper)) {
    wrapper = join(parent, `${base} (${n})`)
    n += 1
  }
  mkdirSync(wrapper, { recursive: true })
  return wrapper
}

async function ensureInstallLocationId(path: string): Promise<string> {
  const client = await getClient()
  const list = await client.call<InstallLocationsListResult>(
    'Install.Locations.List'
  )
  const existing = list.installLocations?.find((loc) => loc.path === path)
  if (existing) return existing.id

  const added = await client.call<InstallLocationsAddResult>(
    'Install.Locations.Add',
    { path }
  )
  return added.installLocation.id
}

export async function getSettings(appName: string): Promise<GameSettings> {
  return (
    GameConfig.get(appName).config ||
    (await GameConfig.get(appName).getSettings())
  )
}

export function getGameInfo(appName: string): GameInfo {
  const info = getItchioLibraryGameInfo(appName)
  if (info) return info

  logError(
    [
      'Could not get game info for',
      `${appName},`,
      'returning empty object. itch.io support is not yet fully implemented.'
    ],
    LogPrefix.Itchio
  )
  return {
    app_name: '',
    runner: 'itchio',
    art_cover: '',
    art_square: '',
    install: {},
    is_installed: false,
    title: '',
    canRunOffline: false
  }
}

export function getExtraInfo(appName: string): Promise<ExtraInfo> {
  const game = getItchioLibraryGameInfo(appName)
  return Promise.resolve({
    about: {
      description: game?.description ?? '',
      shortDescription: game?.description ?? ''
    },
    reqs: [],
    releaseDate: undefined,
    storeUrl: game?.store_url,
    changelog: undefined
  })
}

export function importGame(
  appName: string,
  path: string,
  platform: InstallPlatform
): Promise<ExecResult> {
  logNotImplemented('importGame', { appName, path, platform })
  return Promise.resolve({ stdout: '', stderr: NOT_IMPLEMENTED })
}

// butlerd uses JSON-RPC notifications, not stdout. This satisfies the
// GameManager contract; actual progress is wired via `createProgressEmitter`.
export function onInstallOrUpdateOutput(
  appName: string,
  action: 'installing' | 'updating',
  data: string,
  totalDownloadSize: number
): void {
  logInfo(
    [
      `itch.io onInstallOrUpdateOutput passthrough (action=${action})`,
      { appName, dataLength: data.length, totalDownloadSize }
    ],
    LogPrefix.Itchio
  )
}

// Per-call closure-bound progress emitter. butlerd fires Progress
// several times per second; throttle the log output (once per percent
// step or every 2s) so install.log stays readable. Frontend messages
// are not throttled — the progress bar can absorb the rate.
function createProgressEmitter(
  appName: string,
  action: 'installing' | 'updating',
  logWriter: LogWriter
) {
  let lastLoggedPercent = -1
  let lastLoggedAt = 0
  return (p: ButlerdProgress): void => {
    if (p.progress === undefined) return
    const percent = Math.round(p.progress * 100)
    const eta =
      p.eta !== undefined && Number.isFinite(p.eta)
        ? new Date(p.eta * 1000).toISOString().substring(11, 19)
        : ''
    const downSpeed =
      p.bps !== undefined ? Math.round(p.bps / (1024 * 1024)) : undefined

    sendProgressUpdate({
      appName,
      runner: 'itchio',
      status: action,
      progress: { percent, bytes: '', eta, downSpeed }
    })

    const now = Date.now()
    if (percent === lastLoggedPercent && now - lastLoggedAt < 2000) return
    lastLoggedPercent = percent
    lastLoggedAt = now
    const line = `Progress for ${appName}: ${percent}% ${
      eta ? `ETA ${eta}` : ''
    }${downSpeed !== undefined ? ` Down: ${downSpeed}MB/s` : ''}`.trim()
    logInfo(line, LogPrefix.Itchio)
    logWriter.logInfo(line).catch(() => {
      /* writer may be closed */
    })
  }
}

async function closeWriter(writer: LogWriter): Promise<void> {
  try {
    await writer.close()
  } catch {
    /* already closed */
  }
}

export async function install(
  appName: string,
  { path, platformToInstall }: InstallArgs
): Promise<InstallResult> {
  const info = getItchioLibraryGameInfo(appName)
  if (!info) {
    return { status: 'error', error: `Unknown itch.io app ${appName}` }
  }

  const installInfo = await getStrictInstallInfo(appName, platformToInstall)
  if (!installInfo) {
    return {
      status: 'error',
      error: `no ${platformToInstall} upload available for ${appName}`
    }
  }

  const installLogWriter = await createGameLogWriter(
    appName,
    'itchio',
    'install'
  )
  try {
    const headline = `Installing ${appName} (${platformToInstall})`
    logInfo(headline, LogPrefix.Itchio)
    installLogWriter.logInfo(headline)

    const client = await getClient()
    const onProgress = createProgressEmitter(
      appName,
      'installing',
      installLogWriter
    )
    const unsub = client.on('Progress', (params) =>
      onProgress(params as ButlerdProgress)
    )

    const numericGameId = gameIdFromAppName(appName)
    if (numericGameId !== undefined) await clearStaleCavesForGame(numericGameId)

    // Create a `<path>/<Game Name>` wrapper and register IT as butlerd's
    // install location, so butlerd's `game-<id>` slug ends up nested
    // inside the title-named folder. Cave path stays stable (updates keep
    // working) while the file manager shows a friendly name.
    const wrapperFolder = ensureGameWrapperFolder(path, info.title, appName)

    let queued: InstallQueueResult
    try {
      const installLocationId = await ensureInstallLocationId(wrapperFolder)
      queued = await client.call<InstallQueueResult>('Install.Queue', {
        game: installInfo.game,
        upload: installInfo.upload,
        installLocationId,
        reason: 'install'
      })

      await client.call('Install.Perform', {
        id: queued.id,
        stagingFolder: queued.stagingFolder
      })
    } finally {
      unsub()
    }

    installStore.set(appName, installInfo)

    // Re-fetch the cave: butlerd may resolve to a different upload, and
    // the verdict/installFolder live there.
    const caveResult = await client
      .call<FetchCaveResult>('Fetch.Cave', { caveId: queued.caveId })
      .catch((err: Error) => {
        logWarning(
          [
            'itch.io: Fetch.Cave after install failed (using queued values):',
            err.message
          ],
          LogPrefix.Itchio
        )
        return { cave: undefined } as FetchCaveResult
      })
    const cave = caveResult.cave
    const installFolder =
      cave?.installInfo?.installFolder ?? queued.installFolder
    const installedUpload = cave?.upload ?? installInfo.upload
    const installedPlatform = uploadInstalledPlatform(
      installedUpload,
      platformToInstall
    )
    const candidate = pickLaunchCandidate(
      cave?.installInfo?.verdict,
      installedPlatform
    )
    let executable = candidate ? join(installFolder, candidate.path) : ''
    if (
      executable &&
      butlerdPlatformKey(installedPlatform) === 'osx' &&
      executable.endsWith('.app')
    ) {
      executable = resolveAppBundleExecutable(executable)?.path ?? executable
    }
    if (!executable) {
      const scanned = scanForExecutable(installFolder, installedPlatform)
      if (scanned) {
        executable = scanned
        logInfo(
          `itch.io install ${appName}: executable picked by folder scan: ${scanned}`,
          LogPrefix.Itchio
        )
      } else {
        logWarning(
          `itch.io install ${appName}: butlerd verdict and folder scan ` +
            'both came up empty; set Target Executable in game settings.',
          LogPrefix.Itchio
        )
      }
    }

    setLibraryInstallState(appName, true)

    const cachedInfo = getItchioLibraryGameInfo(appName)
    if (cachedInfo) {
      cachedInfo.install = {
        install_path: installFolder,
        install_size: String(installInfo.install_size),
        is_dlc: false,
        version: installedUpload?.channelName ?? '0',
        platform: installedPlatform,
        executable,
        appName
      }
      cachedInfo.is_installed = true
      cachedInfo.folder_name = installFolder
      cachedInfo.caveId = queued.caveId
    }

    const updated = getItchioLibraryGameInfo(appName)
    if (updated) sendFrontendMessage('pushGameToLibrary', updated)
    return { status: 'done' }
  } catch (err) {
    logError(
      ['itch.io install failed:', (err as Error).message],
      LogPrefix.Itchio
    )
    return { status: 'error', error: (err as Error).message }
  } finally {
    await closeWriter(installLogWriter)
  }
}

export function isNative(appName: string): boolean {
  const platform = getItchioLibraryGameInfo(appName)?.install?.platform
  if (!platform) return false
  if (isWindows) return true
  const key = butlerdPlatformKey(platform)
  if (isMac && key === 'osx') return true
  if (isLinux && key === 'linux') return true
  return false
}

export function addShortcuts(
  appName: string,
  fromMenu?: boolean
): Promise<void> {
  logNotImplemented('addShortcuts', { appName, fromMenu })
  return Promise.resolve()
}

export function removeShortcuts(appName: string): Promise<void> {
  logNotImplemented('removeShortcuts', { appName })
  return Promise.resolve()
}

// itch.io is DRM-free, so we skip butlerd's Launch RPC (which insists
// on Windows prereq scaffolding) and run the recorded executable directly,
// going through Heroic's wine path on non-Windows for Windows builds.
export async function launch(
  appName: string,
  logWriter: LogWriter,
  _launchArguments?: LaunchOption,
  args: string[] = []
): Promise<boolean> {
  const cached = getItchioLibraryGameInfo(appName)
  if (!cached) {
    logError(`itch.io launch: unknown app ${appName}`, LogPrefix.Itchio)
    return false
  }
  if (!cached.install?.executable) {
    logError(
      `itch.io launch: ${appName} has no executable recorded. Set Target ` +
        'Executable in the game settings, or reinstall.',
      LogPrefix.Itchio
    )
    return false
  }

  // Some itch.io uploads ship a Windows installer rather than a ready-to-run
  // game. butlerd then exposes that installer as the only candidate, so a
  // plain launch ends up running setup.exe and prompting the user inside Wine.
  // Detect that case, warn the user, and try a silent install into the
  // already-chosen install folder. If the installer flags don't apply, the
  // user can override the executable via Settings > Advanced > Alternative exe.
  const launchArgs = await maybePrepareInstallerLaunch(cached, args)
  if (launchArgs === null) return false

  return launchGame(appName, logWriter, cached, 'itchio', launchArgs)
}

async function maybePrepareInstallerLaunch(
  cached: GameInfo,
  args: string[]
): Promise<string[] | null> {
  const settings = await getSettings(cached.app_name)
  // User-overridden target wins — don't second-guess it.
  if (settings.targetExe) return args

  const executable = cached.install?.executable
  const installPath = cached.install?.install_path
  const platform = cached.install?.platform

  if (!executable || !installPath || !platform) return args
  if (butlerdPlatformKey(platform) !== 'windows') return args
  if (!isLikelyWindowsInstaller(executable)) return args

  logWarning(
    `itch.io launch: ${cached.app_name} executable looks like an installer ` +
      `(${basename(executable)}); attempting silent install into ${installPath}`,
    LogPrefix.Itchio
  )

  const mainWindow = getMainWindow()
  if (mainWindow) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: i18next.t(
        'box.warning.itchio.installer.title',
        'Installer detected'
      ),
      message: i18next.t(
        'box.warning.itchio.installer.message',
        'Heroic detected that the executable for "{{title}}" is an installer ({{exe}}).\n\nHeroic will try to run it silently and install the game into:\n{{path}}\n\nIf the game does not launch afterwards, open the game settings > Advanced > Alternative exe and pick the actual game executable.\n\nContinue launching?',
        {
          title: cached.title,
          exe: basename(executable),
          path: installPath,
          // Native Electron dialog renders text verbatim, so i18next's
          // default HTML-escaping turns "/" into "&#x2F;" on screen.
          interpolation: { escapeValue: false }
        }
      ),
      buttons: [i18next.t('box.yes', 'Yes'), i18next.t('box.no', 'No')],
      defaultId: 0,
      cancelId: 1
    })
    if (response !== 0) return null
  }

  // /quiet covers MSI-style installers; /dir=... is honoured by InnoSetup
  // and a few others. If the installer ignores these flags it will still
  // launch interactively, which is the same behaviour as before this hook.
  return [...args, '/quiet', `/dir=${installPath}`]
}

export async function moveInstall(
  appName: string,
  newInstallPath: string
): Promise<InstallResult> {
  const cached = getItchioLibraryGameInfo(appName)
  const oldPath = cached?.install?.install_path
  if (!oldPath) {
    return { status: 'error', error: 'no current install path' }
  }
  await import('./library').then((m) =>
    m.changeGameInstallPath(appName, newInstallPath)
  )
  logInfo(
    `itch.io moveInstall(${appName}): ${oldPath} -> ${newInstallPath}`,
    LogPrefix.Itchio
  )
  return { status: 'done' }
}

export async function repair(appName: string): Promise<ExecResult> {
  const cached = getItchioLibraryGameInfo(appName)
  if (!cached?.is_installed) {
    return { stdout: '', stderr: `${appName} is not installed` }
  }
  const platform = (cached.install?.platform as InstallPlatform) ?? 'Windows'
  const result = await install(appName, {
    path: cached.install?.install_path ?? '',
    platformToInstall: platform
  })
  return {
    stdout: result.status,
    stderr: result.status === 'error' ? (result.error ?? '') : ''
  }
}

// itch.io has no first-party save sync; intentional no-op.
export function syncSaves(
  appName: string,
  arg: string,
  path: string
): Promise<string> {
  logInfo(
    `itch.io syncSaves no-op (appName=${appName}, arg=${arg}, path=${path})`,
    LogPrefix.Itchio
  )
  return Promise.resolve('')
}

function getCaveId(appName: string): string | undefined {
  return getItchioLibraryGameInfo(appName)?.caveId
}

export async function uninstall({
  appName,
  deleteFiles
}: RemoveArgs): Promise<ExecResult> {
  const caveId = getCaveId(appName)
  if (!caveId) {
    await forceUninstall(appName)
    return { stdout: 'no cave', stderr: '' }
  }
  // butlerd installed into `<wrapper>/game-<id>/` and removes the slug
  // folder on hard uninstall, but leaves the wrapper directory behind.
  // Capture the install path now so we can clean up the empty wrapper
  // ourselves after butlerd is done.
  const installPath = getItchioLibraryGameInfo(appName)?.install?.install_path
  const wrapperFolder = installPath ? join(installPath, '..') : undefined
  const shouldDeleteFiles = deleteFiles ?? true
  try {
    const client = await getClient()
    await client.call('Uninstall.Perform', { caveId, hard: shouldDeleteFiles })
    if (shouldDeleteFiles && wrapperFolder && existsSync(wrapperFolder)) {
      try {
        rmSync(wrapperFolder, { recursive: true, force: true })
      } catch (err) {
        logWarning(
          [
            `itch.io: failed to delete wrapper folder ${wrapperFolder}:`,
            (err as Error).message
          ],
          LogPrefix.Itchio
        )
      }
    }
    installStore.delete(appName)
    setLibraryInstallState(appName, false)
    const updated = getItchioLibraryGameInfo(appName)
    if (updated) sendFrontendMessage('pushGameToLibrary', updated)
    return { stdout: 'done', stderr: '' }
  } catch (err) {
    logError(
      ['itch.io uninstall failed:', (err as Error).message],
      LogPrefix.Itchio
    )
    return { stdout: '', stderr: (err as Error).message }
  }
}

export async function update(appName: string): Promise<InstallResult> {
  const caveId = getCaveId(appName)
  if (!caveId) {
    return { status: 'error', error: `no cave for ${appName}` }
  }
  const cached = getItchioLibraryGameInfo(appName)
  if (!cached?.is_installed) {
    return { status: 'error', error: `${appName} is not installed` }
  }
  const platform = (cached.install?.platform as InstallPlatform) ?? 'Windows'

  const installInfo = (await getItchioLibraryInstallInfo(appName, platform)) as
    | ItchioInstallInfo
    | undefined
  if (!installInfo) {
    return { status: 'error', error: 'no compatible upload for update' }
  }

  const updateLogWriter = await createGameLogWriter(appName, 'itchio', 'update')
  try {
    const headline = `Updating ${appName} (${platform})`
    logInfo(headline, LogPrefix.Itchio)
    updateLogWriter.logInfo(headline)

    const client = await getClient()
    const onProgress = createProgressEmitter(
      appName,
      'updating',
      updateLogWriter
    )
    const unsub = client.on('Progress', (params) =>
      onProgress(params as ButlerdProgress)
    )

    try {
      const queued = await client.call<InstallQueueResult>('Install.Queue', {
        caveId,
        game: installInfo.game,
        upload: installInfo.upload,
        reason: 'update'
      })
      await client.call('Install.Perform', {
        id: queued.id,
        stagingFolder: queued.stagingFolder
      })
    } finally {
      unsub()
    }

    installStore.set(appName, installInfo)
    const updated = getItchioLibraryGameInfo(appName)
    if (updated) sendFrontendMessage('pushGameToLibrary', updated)
    return { status: 'done' }
  } catch (err) {
    logError(
      ['itch.io update failed:', (err as Error).message],
      LogPrefix.Itchio
    )
    return { status: 'error', error: (err as Error).message }
  } finally {
    await closeWriter(updateLogWriter)
  }
}

export async function forceUninstall(appName: string): Promise<void> {
  installStore.delete(appName)
  setLibraryInstallState(appName, false)
  const updated = getItchioLibraryGameInfo(appName)
  if (updated) sendFrontendMessage('pushGameToLibrary', updated)
}

export async function stop(appName: string): Promise<void> {
  const cached = getItchioLibraryGameInfo(appName)
  const executable = cached?.install?.executable
  if (!executable) {
    logWarning(
      `itch.io stop(${appName}): no executable recorded, nothing to kill`,
      LogPrefix.Itchio
    )
    return
  }
  const exeName = executable.split('/').pop() ?? executable
  killPattern(exeName)
  if (!isNative(appName)) {
    const settings = await getSettings(appName)
    shutdownWine(settings)
  }
}

export async function isGameAvailable(appName: string): Promise<boolean> {
  const cached = getItchioLibraryGameInfo(appName)
  if (!cached?.is_installed) return false
  const local = cached.install?.install_path
  if (local && existsSync(join(local))) return true

  const caveId = getCaveId(appName)
  if (!caveId) return false
  try {
    const client = await getClient()
    const result = await client.call<FetchCaveResult>('Fetch.Cave', {
      caveId
    })
    const installFolder = result.cave?.installInfo?.installFolder
    return Boolean(installFolder && existsSync(installFolder))
  } catch (err) {
    logWarning(
      ['itch.io isGameAvailable: Fetch.Cave failed:', (err as Error).message],
      LogPrefix.Itchio
    )
    return false
  }
}
