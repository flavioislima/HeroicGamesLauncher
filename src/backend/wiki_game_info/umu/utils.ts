import axios from 'axios'
import { Runner } from 'common/types'
import { umuStore } from '../electronStore'

interface GameObject {
  title: string
  umu_id: string
}
const storeMapping: Record<Runner, string> = {
  gog: 'gog',
  legendary: 'egs',
  nile: 'amazon',
  sideload: 'sideload',
  zoom: 'zoomplatform',
  humble: 'humble'
}

export async function getUmuId(
  appName: string,
  runner: Runner
): Promise<string | null> {
  // if it's a sideload, there won't be any umu id
  if (runner === 'sideload') {
    return null
  }

  const store = storeMapping[runner]
  const key = `${runner}_${appName}`
  const cachedValue = umuStore.get(key)
  if (cachedValue) {
    return cachedValue
  }
  const response = await axios
    .get<GameObject[]>('https://umu.openwinecomponents.org/umu_api.php', {
      params: { codename: appName.toLowerCase(), store }
    })
    .catch(() => null)

  if (!response || response.status !== 200) {
    return null
  }
  if (response.data.length === 0) {
    umuStore.set(key, null)
    return null
  }
  const umuId = response.data[0].umu_id
  umuStore.set(key, umuId)
  return umuId
}
