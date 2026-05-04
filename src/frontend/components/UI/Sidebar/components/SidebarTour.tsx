import React, { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import Tour, { TourStep } from '../../../../components/Tour/Tour'
import { useTour } from '../../../../state/TourContext'
import ContextProvider from 'frontend/state/ContextProvider'

export const SIDEBAR_TOUR_ID = 'sidebar-tour'

const SidebarTour: React.FC = () => {
  const { t } = useTranslation()
  const { isTourActive } = useTour()
  const { epic, gog, amazon, zoom, humble, platform, isRTL } =
    useContext(ContextProvider)

  // Check if the user is logged into any store
  const isLoggedIn = Boolean(
    epic.username ||
    gog.username ||
    amazon.user_id ||
    humble.user_id ||
    (zoom.enabled && zoom.username)
  )
  const isWin = platform === 'win32'

  // Set position based on RTL
  const position = isRTL ? 'left' : 'right'

  // Create base steps first
  const baseSteps: TourStep[] = [
    {
      element: '[data-tour="sidebar-menu"]',
      intro: t(
        'tour.sidebar.welcome.intro',
        'Welcome to Heroic! This sidebar contains all the navigation options to explore the app.'
      ),
      title: t('tour.sidebar.welcome.title', 'Sidebar Navigation')
    },
    {
      element: '[data-tour="sidebar-library"]',
      intro: t(
        'tour.sidebar.library',
        'Access your game library from different stores in one place.'
      ),
      position
    },
    {
      element: '[data-tour="sidebar-stores"]',
      intro: t(
        'tour.sidebar.stores',
        'Browse and shop for games in different stores including Epic, GOG, Amazon, and Zoom.'
      ),
      position
    },
    {
      element: '[data-tour="sidebar-settings"]',
      intro: t(
        'tour.sidebar.settings',
        "Configure Heroic's settings, game defaults, and more."
      ),
      position
    },
    {
      element: '[data-tour="sidebar-downloads"]',
      intro: t(
        'tour.sidebar.downloads',
        'Track and manage your game downloads and installations.'
      ),
      position
    }
  ]

  // Wine Manager step is for Linux and macOS (non-Windows platforms)
  if (!isWin) {
    baseSteps.push({
      element: '[data-tour="sidebar-wine"]',
      intro: t(
        'tour.sidebar.wine',
        'Manage your Wine/Proton versions for running Windows games on Linux.'
      ),
      position
    })
  }

  // Conditionally add Login or Manage Accounts step based on login status
  if (isLoggedIn) {
    baseSteps.push({
      element: '[data-tour="sidebar-manage-accounts"]',
      intro: t(
        'tour.sidebar.accounts',
        'Manage your connected store accounts and sign in to new stores.'
      ),
      position
    })
  } else {
    baseSteps.push({
      element: '[data-tour="sidebar-login"]',
      intro: t(
        'tour.sidebar.login',
        'Log in to your game store accounts to access your library.'
      ),
      position
    })
  }

  // Add the remaining steps
  const remainingSteps: TourStep[] = [
    {
      element: '[data-tour="sidebar-accessibility"]',
      intro: t(
        'tour.sidebar.accessibility',
        'Access accessibility features to customize your experience.'
      ),
      position
    },
    {
      element: '[data-tour="sidebar-docs"]',
      intro: t(
        'tour.sidebar.docs',
        'Read documentation for help with using Heroic.'
      ),
      position
    },
    {
      element: '[data-tour="sidebar-community"]',
      intro: t(
        'tour.sidebar.community',
        "Join our community on Discord and support Heroic's development."
      ),
      position
    },
    {
      element: '[data-tour="sidebar-quit"]',
      intro: t('tour.sidebar.quit', 'Exit the application safely.'),
      position
    },
    {
      element: '[data-tour="sidebar-version"]',
      intro: t(
        'tour.sidebar.version',
        'Check your current Heroic version and access tours from here.'
      ),
      position: 'top'
    }
  ]

  // Combine the base steps with the remaining steps
  const steps = [...baseSteps, ...remainingSteps]

  return (
    <Tour
      tourId={SIDEBAR_TOUR_ID}
      steps={steps}
      enabled={isTourActive(SIDEBAR_TOUR_ID)}
    />
  )
}

export default SidebarTour
