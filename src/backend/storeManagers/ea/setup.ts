import {
  LogPrefix,
  logDebug,
  logError,
  logInfo,
  getRunnerLogWriter
} from 'backend/logger'
import { getGameInfo, getInstallMetadata } from './library'
import { GameConfig } from 'backend/game_config'
import {
  checkWineBeforeLaunch,
  sendGameStatusUpdate,
  spawnAsync
} from 'backend/utils'
import { runWineCommand, verifyWinePrefix } from 'backend/launcher'
import { isWindows } from 'backend/constants/environment'

/**
 * Post-install setup for EA games. EA Desktop relies on a set of
 * registry keys under HKCU\Software\EA Games\... that the game
 * installers expect to find; Maxima writes these via
 * `maxima-lib::util::registry`. We invoke the same path here for the
 * Heroic-managed Wine prefix.
 *
 * On Windows we still ask Maxima to write the keys (it's a no-op-ish
 * registry add). On Linux/macOS we route the registry writes through
 * `runWineCommand` so they land in the correct prefix.
 */
export default async function setup(
  appName: string,
  installedPath?: string
): Promise<void> {
  const gameInfo = getGameInfo(appName)
  if (!gameInfo) {
    logError([`Could not find EA game info for ${appName}. Skipping setup`])
    return
  }

  const basePath = installedPath ?? gameInfo.install.install_path
  if (!basePath) {
    logError([
      `Could not find EA install path for ${gameInfo.title ?? appName}. Skipping setup`
    ])
    return
  }

  const metadata = getInstallMetadata(appName)
  const contentIds = metadata?.content_ids ?? []
  if (!contentIds.length) {
    logInfo(
      ['No EA content IDs to register for', gameInfo.title ?? appName],
      LogPrefix.EA
    )
    return
  }

  const gameSettings = GameConfig.get(appName).config
  if (!isWindows) {
    const logWriter = getRunnerLogWriter('ea')
    const isWineOk = await checkWineBeforeLaunch(
      gameInfo,
      gameSettings,
      logWriter
    )
    if (!isWineOk) {
      logError(
        ['Could not run EA setup using', gameSettings.wineVersion.name],
        LogPrefix.EA
      )
      return
    }
    await verifyWinePrefix(gameSettings)
  }

  sendGameStatusUpdate({
    appName,
    runner: 'ea',
    status: 'redist',
    context: 'EA'
  })

  for (const contentId of contentIds) {
    const regKey = `HKCU\\Software\\EA Games\\${contentId}`
    const installDirValue = basePath.replace(/\\/g, '\\\\')
    logDebug(['Registering EA content', contentId, 'at', regKey], LogPrefix.EA)

    if (isWindows) {
      await spawnAsync('reg', [
        'add',
        regKey,
        '/v',
        'Install Dir',
        '/t',
        'REG_SZ',
        '/d',
        basePath,
        '/f'
      ])
      continue
    }

    await runWineCommand({
      gameSettings,
      gameInstallPath: basePath,
      commandParts: [
        'reg',
        'add',
        regKey,
        '/v',
        'Install Dir',
        '/t',
        'REG_SZ',
        '/d',
        installDirValue,
        '/f'
      ],
      wait: true,
      protonVerb: 'run',
      startFolder: basePath
    })
  }
}
