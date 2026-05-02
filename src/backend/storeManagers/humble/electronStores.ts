import CacheStore from 'backend/cache'
import { TypeCheckedStoreBackend } from 'backend/electron_store'
import { GameInfo } from 'common/types'
import { HumbleInstallInfo } from 'common/types/humble'

export const installStore = new CacheStore<HumbleInstallInfo>(
  'humble_install_info'
)

export const libraryStore = new CacheStore<GameInfo[], 'library'>(
  'humble_library',
  null
)

export const configStore = new TypeCheckedStoreBackend('humbleConfigStore', {
  cwd: 'humble_store'
})
