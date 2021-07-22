import React from 'react'

export enum FlagPosition {
  NONE = 'none',
  PREPEND = 'prepend',
  APPEND = 'append'
}

interface Props {
  className?: string
  currentLanguage?: string
  flagPossition?: FlagPosition
  handleLanguageChange: (language: string) => void
}

export default function LanguageSelector({
  handleLanguageChange,
  currentLanguage = 'en',
  className = 'settingSelect',
  flagPossition = FlagPosition.NONE
}: Props) {
  const languageLabels: { [key: string]: string } = {
    ca: 'Català',
    cs: 'Čeština',
    de: 'Deutsch',
    el: 'Greek',
    en: 'English',
    es: 'Español',
    fr: 'Français',
    hu: 'Magyar',
    it: 'Italiano',
    ml: 'മലയാളം',
    nl: 'Nederlands',
    pl: 'Polski',
    pt: 'Português',
    ru: 'Русский',
    sv: 'Svenska',
    tr: 'Türkçe',
    zh_Hans: '简化字'
  }

  const languageFlags: { [key: string]: string } = {
    // Catalan isn't a sovereign state (yet). So it hasn't a flag in the unicode standard.
    ca: '🇪🇸',
    cs: '🇨🇿',
    de: '🇩🇪',
    el: '🇬🇷',
    en: '🇬🇧',
    es: '🇪🇸',
    fr: '🇫🇷',
    hu: '🇭🇺',
    it: '🇮🇹',
    ml: '🇮🇳',
    nl: '🇳🇱',
    pl: '🇵🇱',
    pt: '🇵🇹',
    ru: '🇷🇺',
    sv: '🇸🇪',
    tr: '🇹🇷',
    zh_Hans: '🇨🇳'
  }

  const renderOption = (lang: string) => {
    const flag = languageFlags[lang]
    let label = languageLabels[lang]
    if (flagPossition === FlagPosition.PREPEND) label = `${flag} ${label}`
    if (flagPossition === FlagPosition.APPEND) label = `${label} ${flag}`

    return (
      <option key={lang} value={lang}>
        {label}
      </option>
    )
  }
  return (
    <select
      data-testid="languageSelector"
      onChange={(event) => handleLanguageChange(event.target.value)}
      className={className}
      value={currentLanguage}
    >
      {Object.keys(languageLabels).map((lang) => renderOption(lang))}
    </select>
  )
}
