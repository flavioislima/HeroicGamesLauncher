/**
 * Types for the itch.io store integration.
 *
 * These mirror butler / butlerd JSON-RPC schemas; the canonical reference is
 * https://docs.itch.ovh/butlerd/master/ — keep them in sync with the version
 * of butler bundled by Heroic.
 */

import type { LaunchOption } from 'common/types'

// itch.io upload platforms exposed by butlerd. Linux + macOS use lower-case
// keys in the wire format.
export type ItchioInstallPlatform = 'windows' | 'linux' | 'osx'

export interface ItchioUserData {
  id: number
  username: string
  display_name?: string
  url: string
  cover_url?: string
  press_user?: boolean
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
  display_name?: string
  url: string
}

export interface ItchioGame {
  id: number
  title: string
  url: string
  short_text?: string
  cover_url?: string
  still_cover_url?: string
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
  // itch.io has no DLC concept; declared as a required empty array so
  // the generic `InstallInfo['game'].owned_dlc` access in DownloadDialog
  // narrows cleanly across all union variants.
  owned_dlc: { app_name: string; title: string }[]
}

export interface ItchioUpload {
  id: number
  filename: string
  display_name?: string
  size: number
  channel_name?: string
  platforms: Partial<Record<ItchioInstallPlatform, boolean>>
}

export interface ItchioCave {
  id: string
  game_id: number
  install_folder: string
  installed_size: number
  channel_name?: string
  build?: {
    id: number
    version: string
    user_version?: string
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
