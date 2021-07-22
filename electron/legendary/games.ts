import {
  existsSync,
  mkdirSync,
  unlink,
  writeFile
} from 'graceful-fs'
import axios from 'axios';

import { BrowserWindow, app, ipcMain } from 'electron';
import { DXVK } from '../dxvk'
import { ExtraInfo, GameStatus, InstallProgress } from '../types';
import { Game } from '../games';
import { GameConfig } from '../game_config';
import { GlobalConfig } from '../config';
import { LegendaryLibrary } from './library'
import { LegendaryUser } from './user';
import {
  errorHandler,
  execAsync,
  isOnline
} from '../utils'
import {
  execOptions,
  heroicGamesConfigPath,
  heroicIconFolder,
  home,
  isWindows,
  legendaryBin
} from '../constants'
import { logError, logInfo, logWarning } from '../logger';
import { spawn } from 'child_process';
import Store from 'electron-store'
import makeClient from 'discord-rich-presence-typescript';

const store = new Store({
  cwd: 'store',
  name: 'gameinfo'
})
class LegendaryGame extends Game {
  public appName: string
  public state : GameStatus
  private static instances : Map<string, LegendaryGame> = new Map()

  private constructor(appName: string) {
    super()
    this.appName = appName
    this.state = {
      appName: appName,
      status: 'done'
    }
  }

  public static get(appName: string) {
    if (LegendaryGame.instances.get(appName) === undefined) {
      LegendaryGame.instances.set(appName, new LegendaryGame(appName))
    }
    return LegendaryGame.instances.get(appName)
  }

  /**
   * Alias for `LegendaryLibrary.listUpdateableGames`
   */
  public static async checkGameUpdates() {
    const isLoggedIn = await LegendaryUser.isLoggedIn()
    if (!isLoggedIn){
      return []
    }
    return await LegendaryLibrary.get().listUpdateableGames()
  }

  /**
   * Alias for `LegendaryLibrary.getGameInfo(this.appName)`
   *
   * @returns GameInfo
   */
  public async getGameInfo() {
    return await LegendaryLibrary.get().getGameInfo(this.appName)
  }

  private async getProductSlug(namespace: string) {
    const graphql = JSON.stringify({
      query: `{Catalog{catalogOffers( namespace:"${namespace}"){elements {productSlug}}}}`,
      variables: {}
    })
    const result = await axios('https://www.epicgames.com/graphql', {
      data: graphql,
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })
    const res = result.data.data.Catalog.catalogOffers
    const slug = res.elements.find((e: { productSlug: string }) => e.productSlug)
    if (slug) {
      return slug.productSlug.replace(/(\/.*)/, '')
    } else {
      return this.appName
    }
  }

  /**
   * Get extra info from Epic's API.
   *
   * @param namespace
   * @returns
   */
  public async getExtraInfo(namespace: string | null) : Promise<ExtraInfo> {
    if (store.has(namespace)){
      return store.get(namespace) as ExtraInfo
    }
    if (!(await isOnline())) {
      return {
        about: {},
        reqs: []
      } as ExtraInfo
    }
    let lang = GlobalConfig.get().config.language
    if (lang === 'pt') {
      lang = 'pt-BR'
    }

    let epicUrl: string
    if (namespace) {
      const productSlug: string = await this.getProductSlug(namespace)
      epicUrl = `https://store-content.ak.epicgames.com/api/${lang}/content/products/${productSlug}`
    } else {
      epicUrl = `https://store-content.ak.epicgames.com/api/${lang}/content/products/${this.appName}`
    }
    try {
      const response = await axios({
        method: 'GET',
        url: epicUrl
      })
      delete response.data.pages[0].data.requirements.systems[0].details[0]
      const about = response.data.pages.find(
        (e: { type: string }) => e.type === 'productHome'
      )
      store.set(namespace, {about: about.data.about, reqs: about.data.requirements.systems[0].details})
      return {
        about: about.data.about,
        reqs: about.data.requirements.systems[0].details
      } as ExtraInfo
    } catch (error) {
      return {
        about: {},
        reqs: []
      } as ExtraInfo
    }
  }

  /**
   * Alias for `GameConfig.get(this.appName).config`
   * If it doesn't exist, uses getSettings() instead.
   *
   * @returns GameConfig
   */
  public async getSettings() {
    return GameConfig.get(this.appName).config || await GameConfig.get(this.appName).getSettings()
  }

  /**
   * Helper for `checkGameUpdates().contains(this.appName)`
   *
   * @returns If game has an update.
   */
  public async hasUpdate() {
    return (await LegendaryLibrary.get().listUpdateableGames()).includes(this.appName)
  }

  /**
   * Parent folder to move app to.
   * Amends install path by adding the appropriate folder name.
   *
   * @param newInstallPath
   * @returns The amended install path.
   */
  public async moveInstall(newInstallPath : string) {
    this.state.status = 'moving'
    const info = await this.getGameInfo()
    newInstallPath += '/' + info.install.install_path.split('/').slice(-1)[0]
    const installpath = info.install.install_path
    await execAsync(`mv -f ${installpath} '${newInstallPath}'`)
      .then(() => {
        LegendaryLibrary.get().changeGameInstallPath(this.appName, newInstallPath)
      })
      .catch(logError)
    this.state.status = 'done'
    return newInstallPath
  }

  /**
   * Update game.
   * Does NOT check for online connectivity.
   *
   * @returns Result of execAsync.
   */
  public async update() {
    this.state.status = 'updating'
    const { maxWorkers } = (await GlobalConfig.get().getSettings())
    const workers = maxWorkers === 0 ? '' : ` --max-workers ${maxWorkers}`
    const command = `update ${this.appName}${workers} -y`.split(' ')
    let isVerifying = false

    return new Promise((res) => {
      const child = spawn(legendaryBin, command)
      const progress: InstallProgress = {
        bytes: '0.00MiB',
        eta: '00:00:00',
        percent: '0.00%'
      }
      ipcMain.handle('requestUpdateProgress', async (event, appName) => {
        child.stderr.once('data', (data) => {
          isVerifying = `${data}`.includes('Game needs to be verified')
          if (appName === this.appName){
            if (isVerifying){
              child.stdout.once('data', (data) => {
                progress.bytes = `${String(data).split(' ')[2]}MiB`
                progress.percent = `${data}`.split(' ')[3].split(')')[0].replace('(', '')
                progress.eta = 'verifying'
                return progress
              })
            }
            const percentProgress = `${data}`.split('\n')[0].split(' ')
            const downloadProgress = `${data}`.split('\n')[1].split(' ')
            progress.bytes = `${downloadProgress[5] || '0.00'}MiB`
            progress.percent = percentProgress[4]
            progress.eta = percentProgress[10]
            return progress
          }
        })
        logInfo(JSON.stringify(progress))
        return progress
      })
      child.on('exit', () => {
        logInfo('child exiting')
        res('game updated')
      })
    })
  }

  public async getIcon(appName: string){
    if (!existsSync(heroicIconFolder)){
      mkdirSync(heroicIconFolder)
    }

    const gameInfo = await this.getGameInfo()
    const image = gameInfo.art_square.replaceAll(' ', '%20')
    let ext = image.split('.').reverse()[0]
    if (ext !== 'jpg' && ext !== 'png'){
      ext = 'jpg'
    }
    const icon = `${heroicIconFolder}/${appName}.${ext}`
    if (!existsSync(icon)) {
      await execAsync(`curl '${image}' --output ${icon}`)
    }
    return icon
  }

  /**
   * Adds a desktop shortcut to $HOME/Desktop and to /usr/share/applications
   * so that the game can be opened from the start menu and the desktop folder.
   * Both can be disabled with enableDesktopShortcutsOnDesktop and enableDesktopShortcutsOnStartMenu
   * @async
   * @public
   */
  public async addDesktopShortcut(fromMenu?: boolean) {
    const gameInfo = await this.getGameInfo()
    let shortcut;
    let ext;
    const icon = await this.getIcon(gameInfo.app_name)

    switch(process.platform) {
    case 'linux': {
      ext = '.desktop'
      shortcut = `[Desktop Entry]
Name=${gameInfo.title}
Exec=xdg-open heroic://launch/${gameInfo.app_name}
Terminal=false
Type=Application
MimeType=x-scheme-handler/heroic;
Icon=${icon}
Categories=Game;
`
      break; }
    case 'win32': {
      ext = '.url'
      shortcut = `[InternetShortcut]
      IDList=
      IconIndex=0
      URL=heroic://launch/${gameInfo.app_name}
      IconFile=${icon}`
      break; }
    default:
      logError("Shortcuts haven't been implemented in the current platform.")
      return
    }
    const { addDesktopShortcuts, addStartMenuShortcuts } = await GlobalConfig.get().getSettings()

    const desktopFolder = `${app.getPath('desktop')}/${gameInfo.title}${ext}`
    const applicationsFolder = `${home}/.local/share/applications/${gameInfo.title}${ext}`

    if (addDesktopShortcuts || fromMenu) {
      writeFile(desktopFolder, shortcut, () => {
        logInfo('Shortcut saved on ' + desktopFolder)
      })
    }
    if (addStartMenuShortcuts || fromMenu) {
      writeFile(applicationsFolder, shortcut, () => {
        logInfo('Shortcut saved on ' + applicationsFolder)
      })
    }
    return
  }

  /**
   * Removes a desktop shortcut from $HOME/Desktop and to $HOME/.local/share/applications
   * @async
   * @public
   */
  public async removeDesktopShortcut() {
    const gameInfo = await this.getGameInfo()
    const ext = process.platform == 'linux' ? '.desktop' : '.url'
    const desktopFile = `${app.getPath('desktop')}/${gameInfo.title}${ext}`
    const applicationsFile = `${home}/.local/share/applications/${gameInfo.title}${ext}`
    unlink(desktopFile, () => logInfo('Desktop shortcut removed'))
    unlink(applicationsFile, () => logInfo('Applications shortcut removed'))
  }

  /**
   * Install game.
   * Does NOT check for online connectivity.
   *
   * @returns Result of execAsync.
   */
  public async install(path : string) {
    this.state.status = 'installing'
    const { maxWorkers } = (await GlobalConfig.get().getSettings())
    const workers = maxWorkers === 0 ? '' : `--max-workers ${maxWorkers}`

    const logPath = `"${heroicGamesConfigPath}${this.appName}.log"`
    const writeLog = isWindows ? `2>&1 > ${logPath}` : `|& tee ${logPath}`
    const command = `${legendaryBin} install ${this.appName} --base-path ${path} ${workers} -y ${writeLog}`
    logInfo(`Installing ${this.appName} with:`, command)
    try {
      LegendaryLibrary.get().installState(this.appName, true)
      return await execAsync(command, execOptions).then((v) => {
        this.state.status = 'done'
        this.addDesktopShortcut()
        return v
      })
    } catch (error) {
      LegendaryLibrary.get().installState(this.appName, false)
      return errorHandler({error, logPath}).then((v) => {
        this.state.status = 'done'
        return v
      })
    }
  }

  public async uninstall() {
    this.state.status = 'uninstalling'
    const command = `${legendaryBin} uninstall ${this.appName} -y`
    logInfo(`Uninstalling ${this.appName} with:`, command)
    LegendaryLibrary.get().installState(this.appName, false)
    return await execAsync(command, execOptions).then((v) => {
      this.state.status = 'done'
      this.removeDesktopShortcut()
      return v
    })
  }

  /**
   * Repair game.
   * Does NOT check for online connectivity.
   *
   * @returns Result of execAsync.
   */
  public async repair() {
    this.state.status = 'repairing'
    const { maxWorkers } = (await GlobalConfig.get().getSettings())
    const workers = maxWorkers ? `--max-workers ${maxWorkers}` : ''

    const logPath = `"${heroicGamesConfigPath}${this.appName}.log"`
    const writeLog = isWindows ? `2>&1 > ${logPath}` : `|& tee ${logPath}`

    const command = `${legendaryBin} repair ${this.appName} ${workers} -y ${writeLog}`

    logInfo(`Repairing ${this.appName} with:`, command)
    return await execAsync(command, execOptions).then((v) => {
      this.state.status = 'done'
      return v
    })
  }

  public async import(path : string) {
    this.state.status = 'installing'
    const command = `${legendaryBin} import-game ${this.appName} '${path}'`
    return await execAsync(command, execOptions).then((v) => {
      this.state.status = 'done'
      return v
    })
  }

  /**
   * Sync saves.
   * Does NOT check for online connectivity.
   *
   * @returns Result of execAsync.
   */
  public async syncSaves(arg : string, path : string) {
    const fixedPath = isWindows ? path.replaceAll("'", '').slice(0, -1) : path.replaceAll("'", '')
    const command = `${legendaryBin} sync-saves ${arg} --save-path "${fixedPath}" ${this.appName} -y`
    const legendarySavesPath = `${home}/legendary/.saves`

    //workaround error when no .saves folder exists
    if (!existsSync(legendarySavesPath)) {
      mkdirSync(legendarySavesPath, { recursive: true })
    }

    logInfo('\n syncing saves for ', this.appName)
    return await execAsync(command, execOptions)
  }

  public async launch() {
    this.state.status = 'launching'
    const mainWindow = BrowserWindow.getAllWindows()[0]

    let envVars = ''
    let gameMode: string

    const {
      winePrefix,
      wineVersion,
      otherOptions,
      useGameMode,
      showFps,
      nvidiaPrime,
      launcherArgs = '',
      showMangohud,
      audioFix,
      autoInstallDxvk,
      offlineMode
    } = await this.getSettings()

    const { discordRPC } = (await GlobalConfig.get().getSettings())
    const DiscordRPC = discordRPC ? makeClient('852942976564723722') : null
    const runOffline = offlineMode ? '--offline' : ''

    if (discordRPC) {
      // Show DiscordRPC
      // This seems to run when a game is updated, even though the game doesn't start after updating.
      const gameInfo = await this.getGameInfo()
      let os: string

      switch (process.platform) {
      case 'linux':
        os = 'Linux'
        break
      case 'win32':
        os = 'Windows'
        break
      case 'darwin':
        os = 'MacOS'
        break
      default:
        os = 'Unknown OS'
        break
      }

      logInfo('Updating Discord Rich Presence information...')
      DiscordRPC.updatePresence({
        details: gameInfo.title,
        instance: true,
        largeImageKey: 'icon',
        large_text: gameInfo.title,
        startTimestamp: Date.now(),
        state: 'via Heroic on ' + os
      })
    }

    if (isWindows) {
      const command = `${legendaryBin} launch ${this.appName} ${runOffline} ${launcherArgs}`
      logInfo('\n Launch Command:', command)
      const v = await execAsync(command, execOptions)

      logInfo('Stopping Discord Rich Presence if running...')
      discordRPC && DiscordRPC.disconnect()
      logInfo('Stopped Discord Rich Presence.')

      return v
    }

    const fixedWinePrefix = winePrefix.replace('~', home)
    let wineCommand = `--wine ${wineVersion.bin}`

    // We need to keep replacing the ' to keep compatibility with old configs
    let prefix = `--wine-prefix '${fixedWinePrefix.replaceAll("'", '')}'`

    const isProton =
      wineVersion.name.includes('Proton') ||
      wineVersion.name.includes('Steam')
    prefix = isProton ? '' : prefix

    const options = {
      audio: audioFix ? `PULSE_LATENCY_MSEC=60` : '',
      fps: showFps ? `DXVK_HUD=fps` : '',
      other: otherOptions ? otherOptions : '',
      prime: nvidiaPrime ? '__NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia' : '',
      proton: isProton
        ? `STEAM_COMPAT_CLIENT_INSTALL_PATH=${home}/.steam/steam STEAM_COMPAT_DATA_PATH='${winePrefix
          .replaceAll("'", '')
          .replace('~', home)}'`
        : '',
      showMangohud: showMangohud ? `MANGOHUD=1` : ''
    }


    envVars = Object.values(options).join(' ')
    if (isProton) {
      logWarning(
        `\n You are using Proton, this can lead to some bugs,
              please do not open issues with bugs related with games`,
        wineVersion.name
      )
    }

    // Proton doesn't create a prefix folder so this is a workaround
    if (isProton && !existsSync(fixedWinePrefix)) {
      const command = `mkdir '${fixedWinePrefix}' -p`
      await execAsync(command, execOptions)
    }

    // Install DXVK for non Proton Prefixes
    if (!isProton && autoInstallDxvk) {
      await DXVK.install(winePrefix)
    }

    if (wineVersion.name !== 'Wine Default') {
      const { bin } = wineVersion
      wineCommand = isProton
        ? `--no-wine --wrapper "${bin} run"`
        : `--wine ${bin}`
    }

    // check if Gamemode is installed
    await execAsync(`which gamemoderun`)
      .then(({ stdout }) => (gameMode = stdout.split('\n')[0]))
      .catch(() => logWarning('GameMode not installed'))

    const runWithGameMode = useGameMode && gameMode ? gameMode : ''

    const command = `${envVars} ${runWithGameMode} ${legendaryBin} launch ${this.appName} ${runOffline} ${wineCommand} ${prefix} ${launcherArgs}`
    logInfo('\n Launch Command:', command)
    const v = await execAsync(command, execOptions).then((v) => {
      this.state.status = 'playing'
      mainWindow.show()
      return v
    })

    logInfo('Stopping Discord Rich Presence if running...')
    discordRPC && DiscordRPC.disconnect()
    logInfo('Stopped Discord Rich Presence.')

    return v
  }

  public async stop() {
    // until the legendary bug gets fixed, kill legendary on mac
    // not a perfect solution but it's the only choice for now

    // @adityaruplaha: this is kinda arbitary and I don't understand it.
    const pattern = process.platform === 'linux' ? this.appName : 'legendary'
    logInfo('killing', pattern)

    if (process.platform === 'win32'){
      try {
        await execAsync(`Stop-Process -name  ${pattern}`, execOptions)
        return logInfo(`${pattern} killed`);
      } catch (error) {
        return logError(`not possible to kill ${pattern}`, error);
      }
    }

    const child =  spawn('pkill', ['-f', pattern])
    child.on('exit', () => {
      return logInfo(`${pattern} killed`);
    })
  }
}

export {
  LegendaryGame
}
