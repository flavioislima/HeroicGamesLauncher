import { gameManagerMap, libraryManagerMap } from 'backend/storeManagers'
import { TypeCheckedStoreBackend } from './../electron_store'
import { logError, logInfo, LogPrefix, logWarning } from 'backend/logger'
import { getFileSize, removeFolder, sendGameStatusUpdate } from '../utils'
import { DMQueueElement, DMStatus, DownloadManagerState } from 'common/types'
import { installQueueElement, updateQueueElement } from './utils'
import { sendFrontendMessage } from '../ipc'
import { callAbortController } from 'backend/utils/aborthandler/aborthandler'
import { notify } from '../dialog/dialog'
import i18next from 'i18next'
import { createRedistDMQueueElement } from 'backend/storeManagers/gog/redist'
import { existsSync } from 'fs'
import { gogRedistPath } from 'backend/storeManagers/gog/constants'
import { onConnectivityChange } from 'backend/online_monitor'

const downloadManager = new TypeCheckedStoreBackend('downloadManager', {
  cwd: 'store',
  name: 'download-manager'
})

/*
#### Private ####
*/

let queueState: DownloadManagerState = 'idle'
let currentElement: DMQueueElement | null = null
let autoPaused = false

onConnectivityChange((status) => {
  if (status === 'offline' && isRunning()) {
    logInfo('System offline, auto-pausing downloads', LogPrefix.DownloadManager)
    pauseCurrentDownload()
    autoPaused = true
  } else if (status === 'online' && autoPaused) {
    logInfo('System online, auto-resuming downloads', LogPrefix.DownloadManager)
    autoPaused = false
    void resumeCurrentDownload()
  }
})

function getFirstQueueElement() {
  const elements = downloadManager.get('queue', [])
  return elements.at(0) ?? null
}

function isPaused(): boolean {
  return queueState === 'paused'
}

function isIdle(): boolean {
  return queueState === 'idle' || !currentElement
}

function isRunning(): boolean {
  return queueState === 'running'
}

function addToFinished(element: DMQueueElement, status: DMStatus) {
  const elements = downloadManager.get('finished', [])

  const elementIndex = elements.findIndex(
    (el) => el.params.appName === element.params.appName
  )

  if (elementIndex >= 0) {
    elements[elementIndex] = { ...element, status: status ?? 'abort' }
  } else {
    elements.push({ ...element, status })
  }

  downloadManager.set('finished', elements)
  logInfo(
    [element.params.appName, 'added to download manager finished.'],
    LogPrefix.DownloadManager
  )
}

/*
#### Public ####
*/

async function initQueue() {
  let element = getFirstQueueElement()

  while (element) {
    const queuedElements = downloadManager.get('queue', [])
    element.startTime = Date.now()
    queuedElements[0] = element
    downloadManager.set('queue', queuedElements)

    currentElement = element

    queueState = 'running'
    sendFrontendMessage('changedDMQueueInformation', queuedElements, queueState)

    const { status } =
      element.type === 'install'
        ? await installQueueElement(element.params)
        : await updateQueueElement(element.params)
    element.endTime = Date.now()

    processNotification(element, status)

    if (!isPaused()) {
      addToFinished(element, status)
      removeFromQueue(element.params.appName)
      element = getFirstQueueElement()
    } else {
      element = null
    }
  }

  if (queueState !== 'paused') {
    queueState = 'idle'
  }
}

async function addToQueue(element: DMQueueElement) {
  if (!element) {
    logError(
      'Can not add undefined element to queue!',
      LogPrefix.DownloadManager
    )
    return
  }

  sendGameStatusUpdate({
    appName: element.params.appName,
    runner: element.params.runner,
    folder: element.params.path,
    status: 'queued'
  })

  const elements = downloadManager.get('queue', [])

  const elementIndex = elements.findIndex(
    (el) =>
      el.params.appName === element.params.appName &&
      el.params.runner === element.params.runner
  )

  if (elementIndex >= 0) {
    elements[elementIndex] = element
  } else {
    const gameInfo = libraryManagerMap[element.params.runner].getGameInfo(
      element.params.appName
    )
    if (!gameInfo?.isEAManaged && !gameInfo?.isUbisoftManaged) {
      const installInfo = await libraryManagerMap[
        element.params.runner
      ].getInstallInfo(
        element.params.appName,
        element.params.platformToInstall,
        {
          branch: element.params.branch,
          build: element.params.build
        }
      )

      element.params.size = installInfo?.manifest?.download_size
        ? getFileSize(installInfo?.manifest?.download_size)
        : '?? MB'

      if (
        element.params.runner === 'gog' &&
        element.params.platformToInstall.toLowerCase() === 'windows' &&
        installInfo &&
        installInfo.manifest &&
        'dependencies' in installInfo.manifest
      ) {
        const newDependencies = installInfo.manifest.dependencies || []
        if (newDependencies?.length || !existsSync(gogRedistPath)) {
          // create redist element
          const redistElement = createRedistDMQueueElement()
          redistElement.params.dependencies = newDependencies
          elements.push(redistElement)
        }
      }
    } else {
      element.params.size = '?? MB'
    }
    elements.push(element)
  }

  downloadManager.set('queue', elements)
  logInfo(
    [element.params.gameInfo.title, ' was added to the download queue.'],
    LogPrefix.DownloadManager
  )

  sendFrontendMessage('changedDMQueueInformation', elements, queueState)

  if (isIdle()) {
    void initQueue()
  }
}

function removeFromQueue(appName: string) {
  if (appName && downloadManager.has('queue')) {
    const elements = downloadManager.get('queue', [])
    const index = elements.findIndex(
      (queueElement) => queueElement?.params.appName === appName
    )
    if (index !== -1) {
      elements.splice(index, 1)
      downloadManager.delete('queue')
      downloadManager.set('queue', elements)
    }

    sendGameStatusUpdate({
      appName,
      status: 'done'
    })

    logInfo(
      [appName, 'removed from download manager.'],
      LogPrefix.DownloadManager
    )

    sendFrontendMessage('changedDMQueueInformation', elements, queueState)
  }
}

function getQueueInformation() {
  const elements = downloadManager.get('queue', [])
  const finished = downloadManager.get('finished', [])

  return { elements, finished, state: queueState }
}

function cancelCurrentDownload({ removeDownloaded = false }) {
  if (currentElement) {
    if (Array.isArray(currentElement.params.installDlcs)) {
      const dlcsToRemove = currentElement.params.installDlcs
      for (const dlc of dlcsToRemove) {
        removeFromQueue(dlc)
      }
    }
    if (isRunning()) {
      stopCurrentDownload()
    }
    removeFromQueue(currentElement.params.appName)

    if (removeDownloaded) {
      const { appName, runner } = currentElement.params
      const { folder_name } = gameManagerMap[runner].getGameInfo(appName)
      if (folder_name) {
        removeFolder(currentElement.params.path, folder_name)
      }
    }
    currentElement = null
  }
}

function pauseCurrentDownload() {
  if (currentElement) {
    stopCurrentDownload()
  }
  queueState = 'paused'
  autoPaused = false
  sendFrontendMessage(
    'changedDMQueueInformation',
    downloadManager.get('queue', []),
    queueState
  )
}

function resumeCurrentDownload() {
  autoPaused = false
  void initQueue()
}

function stopCurrentDownload() {
  const { appName, runner } = currentElement!.params
  callAbortController(appName)
  gameManagerMap[runner].stop(appName, false)
}

// notify the user based on the status of the element and the status of the queue
function processNotification(element: DMQueueElement, status: DMStatus) {
  const action = element.type === 'install' ? 'Installation' : 'Update'
  if (
    element.params.runner === 'gog' &&
    element.params.appName === 'gog-redist'
  ) {
    return
  }
  const { title } = gameManagerMap[element.params.runner].getGameInfo(
    element.params.appName
  )

  if (status === 'abort') {
    if (isPaused()) {
      logWarning(
        [action, 'of', element.params.appName, 'paused!'],
        LogPrefix.DownloadManager
      )
      // i18next.t('notify.update.paused', 'Update Paused')
      // i18next.t('notify.install.paused', 'Installation Paused')
      notify({ title, body: i18next.t(`notify.${element.type}.paused`) })
    } else {
      logWarning(
        [action, 'of', element.params.appName, 'aborted!'],
        LogPrefix.DownloadManager
      )
      // i18next.t('notify.update.canceled', 'Update Canceled')
      // i18next.t('notify.install.canceled', 'Installation Canceled')
      notify({ title, body: i18next.t(`notify.${element.type}.canceled`) })
    }
  } else if (status === 'error') {
    logWarning(
      [action, 'of', element.params.appName, 'failed!'],
      LogPrefix.DownloadManager
    )
    // i18next.t('notify.update.failed', 'Update Failed')
    // i18next.t('notify.install.failed', 'Installation Failed')
    notify({ title, body: i18next.t(`notify.${element.type}.failed`) })
  } else if (status === 'done') {
    // i18next.t('notify.update.finished', 'Update Finished')
    // i18next.t('notify.install.finished', 'Installation Finished')
    notify({
      title,
      body: i18next.t(`notify.${element.type}.finished`)
    })

    logInfo(
      ['Finished', action, 'of', element.params.appName],
      LogPrefix.DownloadManager
    )
  }
}

export {
  initQueue,
  addToQueue,
  removeFromQueue,
  getQueueInformation,
  cancelCurrentDownload,
  pauseCurrentDownload,
  resumeCurrentDownload,
  isRunning
}
