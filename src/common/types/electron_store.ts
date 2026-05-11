import Store from 'electron-store'
import { Get } from 'type-fest'

import {
  WineVersionInfo,
  InstalledInfo,
  UserInfo,
  RecentGame,
  HiddenGame,
  FavouriteGame,
  DMQueueElement,
  GOGLoginData,
  AppSettings,
  WikiInfo,
  GameInfo,
  WindowProps,
  UploadedLogData
} from 'common/types'
import { UserData } from 'common/types/gog'
import { NileUserData } from './nile'
import { ItchioUserData } from './itchio'
import { ZoomCredentials } from './zoom'

export interface StoreStructure {
  configStore: {
    userHome: string
    userInfo: UserInfo
    games: {
      recent: RecentGame[]
      hidden: HiddenGame[]
      favourites: FavouriteGame[]
      customCategories: Record<string, string[]>
    }
    theme: string
    zoomPercent: number
    contentFontFamily: string
    actionsFontFamily: string
    allTilesInColor: boolean
    titlesAlwaysVisible: boolean
    disableDialogBackdropClose: boolean
    disableAnimations: boolean
    language: string
    'general-logs': {
      currentLogFile: string
      lastLogFile: string
      legendaryLogFile: string
      gogdlLogFile: string
      nileLogFile: string
    }
    'window-props': WindowProps
    settings: AppSettings
    skipVcRuntime: boolean
    showSnapWarning: boolean
  }
  wineDownloaderInfoStore: {
    'wine-releases': WineVersionInfo[]
  }
  gogInstalledGamesStore: {
    installed: InstalledInfo[]
  }
  zoomInstalledGamesStore: {
    installed: InstalledInfo[]
  }
  timestampStore: {
    [K: string]: {
      firstPlayed: string
      lastPlayed: string
      totalPlayed: number
    }
  }
  fontsStore: {
    fonts: string[]
  }
  gogConfigStore: {
    userData: UserData
    credentials?: GOGLoginData
    isLoggedIn: boolean
  }
  zoomConfigStore: {
    credentials?: ZoomCredentials
    isLoggedIn: boolean
    username?: string
  }
  nileConfigStore: {
    userData?: NileUserData
  }
  itchioConfigStore: {
    userData?: ItchioUserData
  }
  sideloadedStore: {
    games: GameInfo[]
    // FIXME: Not sure if this is correct, seems like this key is only used once
    installed: InstalledInfo[]
  }
  downloadManager: {
    queue: DMQueueElement[]
    finished: DMQueueElement[]
  }
  gogSyncStore: {
    [appName: string]: {
      [saveName: string]: string
    }
  }
  zoomSyncStore: {
    [appName: string]: {
      [saveName: string]: string
    }
  }
  gogPrivateBranches: {
    [appName: string]: string
  }
  wikigameinfo: {
    [title: string]: WikiInfo
  }
  uploadedLogs: Record<string, UploadedLogData>
  migrationsStore: {
    appliedMigrations: string[]
  }
}

export type StoreOptions<T extends Record<string, unknown>> = Store.Options<T>
export type ValidStoreName = keyof StoreStructure

// This is `T`, *except* for when `T` is `unknown`; it then is `never`
// Credits for this goes to michael#7468 on the TS Community Discord server
export type UnknownGuard<T> = unknown extends T
  ? [T] extends [null]
    ? T
    : never
  : T

export abstract class TypeCheckedStore<Name extends ValidStoreName> {
  abstract has(key: string): boolean

  abstract get<KeyType extends string>(
    key: KeyType,
    defaultValue: NonNullable<UnknownGuard<Get<StoreStructure[Name], KeyType>>>
  ): NonNullable<UnknownGuard<Get<StoreStructure[Name], KeyType>>>

  abstract get_nodefault<KeyType extends string>(
    key: KeyType
  ): UnknownGuard<Get<StoreStructure[Name], KeyType> | undefined>

  abstract set<KeyType extends string>(
    key: KeyType,
    value: UnknownGuard<Get<StoreStructure[Name], KeyType>>
  ): void

  // FIXME: This is currently not type-checked properly
  abstract delete<KeyType extends string>(key: KeyType): void

  abstract clear(): void
}
