/**
 * Types for the itch.io store integration.
 *
 * Field-naming convention:
 *   - butlerd JSON-RPC payloads use camelCase (apiKey, displayName,
 *     installFolder, caveId, ...). Types describing wire shapes — anything
 *     a butlerd call directly produces or consumes — therefore use
 *     camelCase.
 *   - Heroic's own `GameInfo` / `InstalledInfo` shapes use snake_case
 *     (app_name, install_path, install_size). `ItchioInstallInfo.manifest`
 *     mirrors those snake_case keys so the rest of Heroic's UI consumes
 *     the union without runtime branching.
 *
 * Reference: https://docs.itch.ovh/butlerd/master/
 */

import type { LaunchOption } from 'common/types'

// itch.io upload platforms exposed by butlerd. Lower-case in the wire format.
export type ItchioInstallPlatform = 'windows' | 'linux' | 'osx'

export interface ItchioUserData {
  id: number
  username: string
  displayName?: string
  url: string
  coverUrl?: string
  pressUser?: boolean
  developer?: boolean
  gamer?: boolean
}

// Data returned to the renderer when starting an itch.io login. itch.io
// doesn't expose a CORS-friendly OAuth flow for desktop clients, so Heroic
// uses an API-key paste flow: the renderer shows `apiKeysUrl` to the user,
// they generate a personal API key on the site, and paste it back as
// `ItchioRegisterData.apiKey`.
export interface ItchioLoginData {
  apiKeysUrl: string
}

export interface ItchioRegisterData {
  apiKey: string
}

export interface ItchioGameUser {
  id: number
  username: string
  displayName?: string
  url: string
}

export interface ItchioGame {
  id: number
  title: string
  url: string
  shortText?: string
  coverUrl?: string
  stillCoverUrl?: string
  classification?:
    | 'game'
    | 'tool'
    | 'assets'
    | 'game_mod'
    | 'physical_game'
    | 'soundtrack'
    | 'other'
    | 'comic'
    | 'book'
  user: ItchioGameUser
  // butlerd reports platform support as a map keyed by 'windows' | 'linux'
  // | 'osx'. Values can be booleans or arch strings ("all", "x64"); we
  // treat any truthy value as supported.
  platforms?: Partial<Record<ItchioInstallPlatform, unknown>>
  // itch.io has no DLC concept; declared as a required empty array so
  // the generic `InstallInfo['game'].owned_dlc` access in DownloadDialog
  // narrows cleanly across all union variants.
  owned_dlc: { app_name: string; title: string }[]
}

export interface ItchioUpload {
  id: number
  filename: string
  displayName?: string
  size: number
  channelName?: string
  platforms: Partial<Record<ItchioInstallPlatform, boolean>>
}

export interface ItchioCaveInstallInfo {
  installFolder: string
  installedSize: number
  pinned?: boolean
}

export interface ItchioCave {
  id: string
  game?: ItchioGame
  upload?: ItchioUpload
  installInfo?: ItchioCaveInstallInfo
  build?: {
    id: number
    version: string
    userVersion?: string
  }
}

export interface ItchioInstallInfo {
  game: ItchioGame
  upload: ItchioUpload
  install_size: number
  download_size: number
  launch_options?: LaunchOption[]
  /**
   * Manifest shape kept structurally compatible with the rest of the
   * `InstallInfo` union so generic UI like DownloadDialog can read
   * `disk_size` / `download_size` without runtime branching.
   */
  manifest: {
    disk_size: number
    download_size: number
  }
}
