import ContextProvider from 'frontend/state/ContextProvider'
import React, { useContext } from 'react'
import { useTranslation } from 'react-i18next'

const STORAGE_KEY = 'analytics-modal-shown'

export default function AnalyticsDialog() {
  const { showDialogModal } = useContext(ContextProvider)

  const { t } = useTranslation()

  React.useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      if (window.isE2ETesting) {
        // Skip showing the dialog in E2E tests
        localStorage.setItem(STORAGE_KEY, 'true')
        return
      }

      showDialogModal({
        showDialog: true,
        title: t('analyticsModal.title', 'Send Anonymous Analytics'),
        message: (
          <>
            {t(
              'analyticsModal.info.pt1',
              'In order to improve the app, Heroic collects 100% anonymous data.'
            )}
            <ul>
              <li>
                {t(
                  'analyticsModal.info.pt2',
                  'Heroic uses the open-source Plausible Analytics platform to gather basic data: App Version, OS, System Architecture, Linux Distribution, Stores Connected and Country.'
                )}
              </li>
              <li>
                {t(
                  'analyticsModal.info.pt3',
                  'It will never collect any personal information, including your username, IP address or email.'
                )}
              </li>
              <li>
                {t(
                  'analyticsModal.info.pt4',
                  'This data is used to give us insights on what to focus on next due to our limited resources and user feedback.'
                )}
              </li>
              <li>
                {t(
                  'analyticsModal.info.pt5',
                  'Plausible Analytics is fully compliant with GDPR, CCPA and PECR.'
                )}
              </li>
              <li>
                {t(
                  'analyticsModal.info.pt6',
                  'For transparency, you can view the data we collect on the Heroic logs.'
                )}
              </li>
            </ul>
            {t(
              'analyticsModal.info.pt7',
              'You can change this setting at any time in the App Settings.'
            )}
          </>
        ),
        buttons: [
          {
            text: t('analyticsModal.enable', 'Enable'),
            onClick: () => {
              localStorage.setItem(STORAGE_KEY, 'true')
              window.api.setSetting({
                appName: 'default',
                key: 'analyticsOptIn',
                value: true
              })
              showDialogModal({ showDialog: false })
            }
          },
          {
            text: t('analyticsModal.disable', 'Disable'),
            onClick: () => {
              localStorage.setItem(STORAGE_KEY, 'true')
              window.api.setSetting({
                appName: 'default',
                key: 'analyticsOptIn',
                value: false
              })
              showDialogModal({ showDialog: false })
            }
          }
        ],
        type: 'MESSAGE'
      })
    }
  }, [showDialogModal])

  return <></>
}
