import React from 'react'

import { GameInfo } from 'common/types'
import { LibraryContextType } from 'frontend/types'

const initialContext: LibraryContextType = {
  storesFilters: {
    legendary: true,
    gog: true,
    nile: true,
    sideload: true,
    zoom: true,
    itchio: true
  },
  platformsFilters: { win: true, linux: true, mac: true, browser: true },
  filterText: '',
  setStoresFilters: () => null,
  handleLayout: () => null,
  setPlatformsFilters: () => null,
  handleSearch: () => null,
  layout: 'grid',
  showHidden: false,
  setShowHidden: () => null,
  showFavourites: false,
  setShowFavourites: () => null,
  showNonAvailable: false,
  setShowNonAvailable: () => null,
  showInstalledOnly: false,
  setShowInstalledOnly: () => null,
  sortDescending: true,
  setSortDescending: () => null,
  sortInstalled: true,
  setSortInstalled: () => null,
  showSupportOfflineOnly: false,
  setShowSupportOfflineOnly: () => null,
  showThirdPartyManagedOnly: false,
  setShowThirdPartyManagedOnly: () => null,
  showUpdatesOnly: false,
  setShowUpdatesOnly: () => null,
  handleAddGameButtonClick: () => null,
  setShowCategories: () => null,
  showAlphabetFilter: false,
  onToggleAlphabetFilter: () => null,
  alphabetFilterLetter: null,
  setAlphabetFilterLetter: () => null,
  gamesForAlphabetFilter: [] as GameInfo[]
}

export default React.createContext(initialContext)
