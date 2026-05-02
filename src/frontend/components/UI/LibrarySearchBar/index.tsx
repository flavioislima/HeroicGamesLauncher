import { useContext, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import ContextProvider from 'frontend/state/ContextProvider'
import { GameInfo, Runner } from 'common/types'
import SearchBar from '../SearchBar'
import { useTranslation } from 'react-i18next'
import LibraryContext from 'frontend/screens/Library/LibraryContext'
import { normalizeTitle } from 'frontend/helpers/library'

function fixFilter(text: string) {
  const regex = new RegExp(/([?\\|*|+|(|)|[|]|])+/, 'g')
  return text.replaceAll(regex, '')
}

const RUNNER_TO_STORE: Partial<Record<Runner, string>> = {
  legendary: 'Epic',
  gog: 'GOG',
  nile: 'Amazon',
  zoom: 'Zoom',
  humble: 'Humble'
}

export default function LibrarySearchBar() {
  const { epic, gog, sideloadedLibrary, amazon, zoom, humble } =
    useContext(ContextProvider)
  const { handleSearch, filterText } = useContext(LibraryContext)
  const navigate = useNavigate()
  const { t } = useTranslation()

  const normalizedFilterText = useMemo(
    () => normalizeTitle(fixFilter(filterText)),
    [filterText]
  )

  const list = useMemo(() => {
    return [
      ...(epic.library ?? []),
      ...(gog.library ?? []),
      ...(sideloadedLibrary ?? []),
      ...(amazon.library ?? []),
      ...(zoom.library ?? []),
      ...(humble.library ?? [])
    ]
      .filter(Boolean)
      .filter((el) => {
        return (
          !el.install.is_dlc &&
          normalizeTitle(el.title).includes(normalizedFilterText)
        )
      })
      .sort((g1, g2) => (g1.title < g2.title ? -1 : 1))
  }, [
    amazon.library,
    epic.library,
    gog.library,
    sideloadedLibrary,
    zoom.library,
    humble.library,
    normalizedFilterText
  ])

  const handleClick = (game: GameInfo) => {
    handleSearch('')
    navigate(`/gamepage/${game.runner}/${game.app_name}`, {
      state: { gameInfo: game }
    })
  }

  const suggestions = list.map((game) => (
    <li onClick={() => handleClick(game)} key={game.app_name}>
      {game.title} <span>({RUNNER_TO_STORE[game.runner] || game.runner})</span>
    </li>
  ))

  const onInputChanged = (text: string) => {
    handleSearch(text)
  }

  return (
    <div data-tour="library-search">
      <SearchBar
        suggestionsListItems={suggestions}
        onInputChanged={onInputChanged}
        value={filterText}
        placeholder={t('search', 'Search for Games')}
      />
    </div>
  )
}
