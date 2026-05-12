import { join } from 'path'
import { getGameInfo } from './games'
import { getInstallInfo } from './library'
import { sendGameStatusUpdate } from 'backend/utils'
import { enable, getStatus, isEnabled } from './eos_overlay/eos_overlay'
import { split } from 'shlex'
import { logError, LogPrefix } from 'backend/logger'
import { runWineCommand } from 'backend/launcher'
import { GameConfig } from 'backend/game_config'
import { epicRedistPath } from './constants'
import { isLinux } from 'backend/constants/environment'
import LogWriter from 'backend/logger/log_writer'

export const legendarySetup = async (appName: string, logWriter: LogWriter) => {
  const gameInfo = getGameInfo(appName)
  if (!gameInfo) {
    return
  }

  sendGameStatusUpdate({
    appName,
    runner: 'legendary',
    status: 'redist',
    context: 'EPIC'
  })

  const gameSettings = GameConfig.get(appName).config

  // Fixes games like Fallout New Vegas and Dishonored: Death of the Outsider
  await runWineCommand({
    gameSettings,
    commandParts: [
      'reg',
      'add',
      'HKEY_CLASSES_ROOT\\com.epicgames.launcher',
      '/f'
    ],
    wait: true,
    protonVerb: 'run'
  })

  const winPlatforms = ['Windows', 'Win32', 'windows']
  if (
    gameInfo.install.platform &&
    winPlatforms.includes(gameInfo.install.platform) &&
    !gameInfo.isEAManaged &&
    !gameInfo.isUbisoftManaged
  ) {
    try {
      const info = await getInstallInfo(appName, gameInfo.install.platform)
      if (
        info.manifest.prerequisites &&
        info.manifest.prerequisites.path.length > 0
      ) {
        await runWineCommand({
          gameSettings,
          gameInstallPath: gameInfo.install.install_path,
          commandParts: [
            join(
              gameInfo.install.install_path ?? '',
              info.manifest.prerequisites.path
            ),
            ...split(info.manifest.prerequisites.args)
          ],
          wait: true,
          protonVerb: 'run'
        })
      }
    } catch (error) {
      logError(`getInstallInfo failed with ${error}`)
    }
  }

  if (gameInfo.isEAManaged) {
    const installerPath = join(epicRedistPath, 'EAappInstaller.exe')
    try {
      await runWineCommand({
        gameSettings,
        commandParts: [
          installerPath,
          'EAX_LAUNCH_CLIENT=0',
          'IGNORE_INSTALLED=1'
        ],
        wait: true,
        protonVerb: 'run'
      })
    } catch (e) {
      logError(`Failed to run EA App installer ${e}`, LogPrefix.Legendary)
    }
  } else if (gameInfo.isUbisoftManaged) {
    const installerPath = join(epicRedistPath, 'UbisoftConnectInstaller.exe')
    console.log('Installing', installerPath)
    try {
      await runWineCommand({
        gameSettings,
        commandParts: [installerPath, '/S'],
        wait: true,
        protonVerb: 'run'
      })
    } catch (e) {
      logError(`Failed to run Ubisoft installer ${e}`, LogPrefix.Legendary)
    }
  }

  // We only want to enable the EOS Overlay on linux
  // On windows, the overlay is installed globally
  // On mac, the overlay doesn't work
  if (isLinux) {
    const isOverlayEnabled = await isEnabled(appName)

    if (!isOverlayEnabled) {
      if (getStatus().isInstalled) {
        void logWriter.logInfo('EOS Overlay: Enabling')
        await enable(appName)
      } else {
        void logWriter.logInfo('EOS Overlay: Not Installed')
      }
    }
  }
}
