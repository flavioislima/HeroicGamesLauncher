import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSetting from 'frontend/hooks/useSetting'
import { PathSelectionBox } from 'frontend/components/UI'

const AltEABin = () => {
  const { t } = useTranslation()
  const [eaVersion, setEAVersion] = useState('')
  const [altEABin, setAltEABin] = useSetting('altEABin', '')

  useEffect(() => {
    const getMoreInfo = async () => {
      const eaVer = await window.api.getEAVersion()
      if (eaVer === 'invalid') {
        setEAVersion('Invalid')
        setTimeout(() => {
          setAltEABin('')
          return setEAVersion('')
        }, 3000)
      }
      return setEAVersion(eaVer)
    }
    getMoreInfo()
  }, [altEABin])

  return (
    <PathSelectionBox
      htmlId="setting-alt-ea"
      label={t(
        'setting.alt-ea-bin',
        'Choose an Alternative EA (Maxima) Binary (needs restart) to use'
      )}
      type="file"
      onPathChange={setAltEABin}
      path={altEABin}
      placeholder={t(
        'placeholder.alt-ea-bin',
        'Maxima binary not bundled — supply a path to maxima-cli...'
      )}
      pathDialogTitle={t(
        'box.choose-ea-binary',
        'Select Maxima Binary (needs restart)'
      )}
      afterInput={
        <span className="smallMessage">
          {t('other.ea-version', 'Maxima Version: ')}
          {eaVersion}
        </span>
      }
    />
  )
}

export default AltEABin
