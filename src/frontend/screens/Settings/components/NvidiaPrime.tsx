import { useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InfoBox, ToggleSwitch } from 'frontend/components/UI'
import useSetting from 'frontend/hooks/useSetting'
import ContextProvider from 'frontend/state/ContextProvider'

const WIKI_URL =
  'https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/wiki/Hybrid-GPUs:-NVIDIA-Optimus-and-AMD-Dynamic-Switchable-Graphics'

const NvidiaPrime = () => {
  const { t } = useTranslation()
  const { platform } = useContext(ContextProvider)
  const isLinux = platform === 'linux'

  const [nvidiaPrime, setNvidiaPrime] = useSetting('nvidiaPrime', false)
  const [numberOfGPUs, setNumberOfGPUs] = useState<number>(0)

  useEffect(() => {
    void window.api.systemInfo
      .get()
      .then((result) => setNumberOfGPUs(result.GPUs.length))
  }, [])

  // if not linux, hide this setting
  // if only 1 GPU is detected, hide it, but only if this was unset
  // we want to still show it if less than 1 GPU and is set so users can disable it
  if (!isLinux || (numberOfGPUs < 2 && !nvidiaPrime)) {
    return <></>
  }

  return (
    <div className="toggleWithInfo">
      <ToggleSwitch
        htmlId="nvidiaPrime"
        value={nvidiaPrime}
        handleChange={() => setNvidiaPrime(!nvidiaPrime)}
        title={t(
          'setting.nvidiaprime.description',
          'Force use of NVIDIA Optimus or AMD Dynamic Switchable Graphics dGPU. ONLY use this for OpenGL and Vulkan games.'
        )}
      />

      <InfoBox text={t('infobox.help')}>
        {t(
          'help.nvidiaprime.details',
          'Use dedicated graphics card to render game on multi-GPU systems. Only needed on gaming laptops or desktops that use a headless GPU for rendering (NVIDIA Optimus, AMD Dynamic Switchable Graphics)'
        )}

        <br />
        <br />
        <a
          className="underlined"
          href=""
          onClick={(event) => {
            event.preventDefault()
            window.api.openExternalUrl(WIKI_URL)
          }}
        >
          {t('help.nvidiaprime.link', 'Check more details in our wiki')}
        </a>
      </InfoBox>
    </div>
  )
}

export default NvidiaPrime
