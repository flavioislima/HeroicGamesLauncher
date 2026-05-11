import CacheStore from 'backend/cache'
import { TypeCheckedStoreBackend } from 'backend/electron_store'
import { GameInfo } from 'common/types'
import { ItchioInstallInfo } from 'common/types/itchio'

export const installStore = new CacheStore<ItchioInstallInfo>(
  'itchio_install_info'
)
export const libraryStore = new CacheStore<GameInfo[], 'library'>(
  'itchio_library',
  null
)

export const configStore = new TypeCheckedStoreBackend('itchioConfigStore', {
  cwd: 'itchio_store'
})
