import { InstalledInfo, Runner } from 'common/types'
import { GOGCloudSavesLocation, SaveFolderVariable } from 'common/types/gog'
import { getWinePath, setupWineEnvVars, verifyWinePrefix } from './launcher'
import { runRunnerCommand as runLegendaryCommand } from 'backend/storeManagers/legendary/library'
import { getSaveSyncLocation, readInfoFile } from './storeManagers/gog/library'
import { logDebug, LogPrefix, logInfo, logError, logWarning } from './logger'
import { getShellPath } from './utils'
import {
  existsSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'graceful-fs'
import { app } from 'electron'
import { gameManagerMap, libraryManagerMap } from 'backend/storeManagers'
import { LegendaryAppName } from './storeManagers/legendary/commands/base'
import { legendaryInstalled } from './storeManagers/legendary/constants'

async function getDefaultSavePath(
  appName: string,
  runner: Runner,
  alreadyDefinedGogSaves: GOGCloudSavesLocation[]
): Promise<string | GOGCloudSavesLocation[]> {
  switch (runner) {
    case 'legendary':
      return getDefaultLegendarySavePath(appName)
    case 'gog':
      return getDefaultGogSavePaths(appName, alreadyDefinedGogSaves)
    case 'nile':
      return ''
    case 'sideload':
      return ''
    case 'zoom':
      return ''
    case 'itchio':
      return ''
  }
}

async function getDefaultLegendarySavePath(appName: string): Promise<string> {
  const { save_folder, save_path } =
    gameManagerMap['legendary'].getGameInfo(appName)
  logInfo(
    ['Computing save path for save folder', save_folder],
    LogPrefix.Legendary
  )
  if (save_path) {
    logDebug(
      ['Legendary has a save path stored, discarding it:', save_path],
      LogPrefix.Legendary
    )
    // FIXME: This isn't really that safe
    try {
      const installedJsonLoc = legendaryInstalled
      const installedJsonData = JSON.parse(
        readFileSync(installedJsonLoc, 'utf-8')
      )
      installedJsonData[appName].save_path = null
      writeFileSync(
        installedJsonLoc,
        JSON.stringify(installedJsonData, undefined, '  ')
      )
    } catch (e) {
      logError(['Failed to discard save path:', e], LogPrefix.Legendary)
      return save_path
    }
  }

  if (!gameManagerMap['legendary'].isNative(appName)) {
    await verifyWinePrefix(
      await gameManagerMap['legendary'].getSettings(appName)
    )
  }

  logInfo(['Computing default save path for', appName], LogPrefix.Legendary)
  await runLegendaryCommand(
    {
      subcommand: 'sync-saves',
      appName: LegendaryAppName.parse(appName),
      '--skip-upload': true,
      '--skip-download': true,
      '--accept-path': true
    },
    {
      abortId: appName + '-savePath',
      logMessagePrefix: 'Getting default save path',
      env: gameManagerMap['legendary'].isNative(appName)
        ? {}
        : setupWineEnvVars(
            await gameManagerMap['legendary'].getSettings(appName)
          )
    }
  )

  // If the save path was computed successfully, Legendary will have saved
  // this path in `installed.json` (so the GameInfo)
  const { save_path: new_save_path } = libraryManagerMap[
    'legendary'
  ].getGameInfo(appName, true)!
  if (!new_save_path) {
    logError(
      ['Unable to compute default save path for', appName],
      LogPrefix.Legendary
    )
    return ''
  }
  logInfo(['Computed save path:', new_save_path], LogPrefix.Legendary)
  return new_save_path
}

async function getDefaultGogSavePaths(
  appName: string,
  alreadyDefinedGogSaves: GOGCloudSavesLocation[]
): Promise<GOGCloudSavesLocation[]> {
  const gameSettings = await gameManagerMap['gog'].getSettings(appName)
  const installInfo = gameManagerMap['gog'].getGameInfo(appName)
    .install as InstalledInfo
  const gog_save_location = await getSaveSyncLocation(appName, installInfo)

  const { platform: installed_platform, install_path } = installInfo
  if (!gog_save_location || !install_path) {
    logError([
      'gog_save_location/install_path undefined. gog_save_location = ',
      gog_save_location,
      'install_path = ',
      install_path
    ])
    return []
  }

  // If no save locations are defined, assume the default
  if (!gog_save_location.length) {
    const clientId = readInfoFile(appName)?.clientId
    gog_save_location.push({
      name: '__default',
      location:
        installed_platform === 'windows'
          ? `%LocalAppData%/GOG.com/Galaxy/Applications/${clientId}/Storage/Shared/Files`
          : `$HOME/Library/Application Support/GOG.com/Galaxy/Applications/${clientId}/Storage`
    })
  }

  const gogVariableMap: Record<string, string> = {
    INSTALL: install_path,
    SAVED_GAMES: '%USERPROFILE%/Saved Games',
    APPLICATION_DATA_LOCAL: '%LOCALAPPDATA%',
    APPLICATION_DATA_LOCAL_LOW: '%APPDATA%\\..\\LocalLow',
    APPLICATION_DATA_ROAMING: '%APPDATA%',
    APPLICATION_SUPPORT: '$HOME/Library/Application Support',
    DOCUMENTS: gameManagerMap['gog'].isNative(appName)
      ? app.getPath('documents')
      : '%USERPROFILE%\\Documents'
  } satisfies Record<SaveFolderVariable, string>
  const resolvedLocations: GOGCloudSavesLocation[] = []
  for (const location of gog_save_location) {
    // If a location with the same name already has a path set,
    // skip doing all this work
    const potAlreadyDefinedLocation = alreadyDefinedGogSaves.find(
      ({ name }) => name === location.name
    )

    if (potAlreadyDefinedLocation?.location.length) {
      resolvedLocations.push(potAlreadyDefinedLocation)
      continue
    }

    // Get all GOG-defined variables out of the path & resolve them
    const matches = location.location.matchAll(/<\?(\w+)\?>/g)
    let locationWithVariablesRemoved = location.location
    for (const match of matches) {
      const matchedText = match[0]
      const variableName = match[1]
      if (!gogVariableMap[variableName]) {
        logWarning(
          [
            'Unknown save path variable:',
            `${variableName},`,
            'inserting variable itself into save path.',
            'User will have to manually correct the path'
          ],
          LogPrefix.Gog
        )
      }
      locationWithVariablesRemoved = locationWithVariablesRemoved.replace(
        matchedText,
        gogVariableMap[variableName] ?? variableName
      )
    }

    // Path now contains no more GOG-defined variables, but might
    // still contain Windows (%NAME%) or Unix ($NAME) ones
    let absolutePath: string
    if (!gameManagerMap['gog'].isNative(appName)) {
      absolutePath = await getWinePath({
        path: locationWithVariablesRemoved,
        gameSettings
      })
      // Wine already resolves symlinks and ./.. for us,
      // so no need to run `realpathSync` here
    } else {
      absolutePath = await getShellPath(locationWithVariablesRemoved)
      if (existsSync(absolutePath)) {
        try {
          absolutePath = realpathSync(absolutePath)
        } catch {
          logWarning(
            ['Failed to run `realpath` on', `"${absolutePath}"`],
            LogPrefix.Gog
          )
        }
      }
    }

    resolvedLocations.push({
      name: location.name,
      location: absolutePath
    })
  }

  return resolvedLocations
}

export { getDefaultSavePath }
