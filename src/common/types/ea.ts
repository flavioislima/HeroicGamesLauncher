import { LaunchOption } from 'common/types'

// EA games are Windows-only (run through Wine/Proton on Linux/macOS)
export type EAInstallPlatform = 'Windows'

interface EAGameManifest {
  download_size: number
  disk_size: number
}

interface EADLCInfo {
  app_name: string
  title: string
}

interface EAGameInstallInfo {
  // EA "offer ID" used as Heroic appName for the runner
  id: string
  app_name: string
  title: string
  version: string
  build_id?: string
  path: string
  is_dlc: boolean
  launch_options: LaunchOption[]
  owned_dlc: EADLCInfo[]
  cloud_saves_supported: boolean
  // Mirrors EA Desktop's content-id/registry-key requirements (see
  // maxima-lib/src/util/registry.rs in upstream Maxima)
  content_ids: string[]
  platform_versions: Record<EAInstallPlatform, string>
}

export interface EAInstallInfo {
  manifest: EAGameManifest
  game: EAGameInstallInfo
}

export interface EAInstallMetadataInfo {
  id: string
  version: string
  build_id?: string
  path: string
  size?: number
  // Content/registry IDs we need to register in the Wine prefix and
  // tear down on uninstall.
  content_ids?: string[]
}

export interface EAGameInfo {
  // EA offer ID
  id: string
  // Human-readable slug, used by maxima-cli (e.g. "swbf2")
  slug?: string
  product: EAGameProduct
}

interface EAGameProduct {
  id: string
  title: string
  productDetail: EAGameProductDetails
}

interface EAGameProductDetails {
  iconUrl: string
  details: {
    backgroundUrl: string
    logoUrl: string
    developer: string
    publisher: string
    releaseDate: string
    genres: string[]
    shortDescription: string
    longDescription: string
    websites: {
      official: string | null
      support: string | null
    }
  }
}

// Persistent EA user data we keep in our config store
export interface EAUserData {
  user_id: string
  persona_id?: string
  name: string
  given_name?: string
  email?: string
  // Region returned by tokeninfo (e.g. "US", "EU")
  home_region?: string
  // ISO timestamp when access token expires; refreshed transparently by
  // the helper binary
  access_token_expires_at?: string
}

// Returned to the frontend so it can pop a system browser window for
// the OAuth code exchange. Mirrors the Nile login flow.
export interface EALoginData {
  // URL the user should open (https://accounts.ea.com/connect/auth?...)
  url: string
  code_verifier: string
  // Localhost callback port we expect the auth code on (Maxima uses 31033)
  callback_port: number
  client_id: string
}

export interface EARegisterData {
  code: string
  code_verifier: string
  callback_port: number
  client_id: string
}

export interface EAGameDownloadInfo {
  download_size: number
  disk_size?: number
}
