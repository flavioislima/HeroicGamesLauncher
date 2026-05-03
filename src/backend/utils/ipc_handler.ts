import { clipboard } from 'electron'
import { addListener, addHandler } from 'backend/ipc'

import { callAbortController } from './aborthandler/aborthandler'
import {
  getCometVersion,
  getEAVersion,
  getGogdlVersion,
  getLegendaryVersion,
  getNileVersion
} from './helperBinaries'
import { hasExecutable } from './os/path'
import { formatSystemInfo, getSystemInfo } from './systeminfo'
import { isIntelMac } from 'backend/constants/environment'

addListener('abort', (event, id) => {
  callAbortController(id)
})
addHandler('getLegendaryVersion', getLegendaryVersion)
addHandler('getGogdlVersion', getGogdlVersion)
addHandler('getCometVersion', getCometVersion)
addHandler('getNileVersion', getNileVersion)
addHandler('getEAVersion', getEAVersion)
addHandler('getSystemInfo', async (e, cache) => getSystemInfo(cache))
addListener('copySystemInfoToClipboard', async () =>
  getSystemInfo().then(formatSystemInfo).then(clipboard.writeText)
)
addHandler('hasExecutable', async (event, executable) => {
  return hasExecutable(executable)
})

addHandler('isIntelMac', () => {
  return isIntelMac
})
