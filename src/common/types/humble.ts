// Use the same casing/spelling as GogInstallPlatform so the SideloadDialog
// platform switch (which already covers windows/osx/linux) doesn't need a
// new case.
export type HumbleInstallPlatform = 'windows' | 'osx' | 'linux'

export interface HumbleUserData {
  user_id: string
  username: string
  email?: string
}

// Raw shapes returned by the (reverse-engineered) Humble Bundle API
// See: https://www.schiff.io/projects/humble-bundle-api/
export interface HumbleDownloadStruct {
  sha1?: string
  name: string
  url: {
    web: string
    bittorrent?: string
  }
  human_size: string
  file_size: number
  small?: number
  md5: string
  // Some downloads carry no timestamp
  timestamp?: number
  uploaded_at?: string
}

export interface HumbleDownload {
  machine_name: string
  // Raw value from the Humble API; "mac" is normalized to "osx" before
  // anything else in the codebase sees it.
  platform: string
  options_dict?: Record<string, unknown>
  download_identifier?: string
  download_version_number?: number | null
  download_struct: HumbleDownloadStruct[]
}

export interface HumbleSubproduct {
  machine_name: string
  human_name: string
  url?: string
  icon?: string
  payee?: { human_name: string; machine_name: string }
  downloads: HumbleDownload[]
  // Steam/Epic/etc. keys live here when the subproduct is not DRM-free
  library_family_name?: string
}

export interface HumbleTpkd {
  machine_name: string
  human_name: string
  key_type: string
  redeemed_key_val?: string
  is_gift?: boolean
}

export interface HumbleOrder {
  gamekey: string
  product?: {
    machine_name: string
    human_name: string
    category?: string
  }
  subproducts: HumbleSubproduct[]
  tpkd_dict?: { all_tpks: HumbleTpkd[] }
  created?: string
}

export interface HumbleInstalledInfo {
  app_name: string
  gamekey: string
  subproduct_machine_name: string
  install_path: string
  platform: HumbleInstallPlatform
  executable?: string
  // md5 of the downloaded archive/installer; used to detect updates
  md5: string
  version: string
  install_size: number
}

export interface HumbleInstallInfo {
  game: {
    app_name: string
    title: string
    version: string
    platform: HumbleInstallPlatform
    machine_name: string
    gamekey: string
    // Empty placeholders so this type is structurally compatible with the
    // shared GameInstallInfo shape used by DLC/launch-option UI components.
    owned_dlc?: Array<{ app_name: string; title: string }>
    launch_options?: never[]
  }
  manifest: {
    download_size: number
    disk_size: number
    md5: string
    download_url: string
  }
}
