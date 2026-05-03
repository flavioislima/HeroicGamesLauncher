import CacheStore from 'backend/cache'
import { TypeCheckedStoreBackend } from 'backend/electron_store'
import { GameInfo } from 'common/types'
import { EAInstallInfo } from 'common/types/ea'

export const installStore = new CacheStore<EAInstallInfo>('ea_install_info')
export const libraryStore = new CacheStore<GameInfo[], 'library'>(
  'ea_library',
  null
)

export const configStore = new TypeCheckedStoreBackend('eaConfigStore', {
  cwd: 'ea_store'
})
