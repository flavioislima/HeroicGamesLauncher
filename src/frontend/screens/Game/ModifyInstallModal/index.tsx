import './index.scss'
import {
  Dialog,
  DialogContent,
  DialogHeader
} from 'frontend/components/UI/Dialog'
import { UpdateComponent } from 'frontend/components/UI'
import { GameInfo } from 'common/types'
import { LegendaryInstallInfo } from 'common/types/legendary'
import { GogInstallInfo } from 'common/types/gog'
import { NileInstallInfo } from 'common/types/nile'
import { ZoomInstallInfo, ZoomInstalledInfo } from 'common/types/zoom'
import { ItchioInstallInfo } from 'common/types/itchio'
import { useTranslation } from 'react-i18next'
import LegendaryModifyInstallModal from './Legendary'
import GOGModifyInstallModal from './GOG'

interface ModifyInstallProps {
  gameInfo: GameInfo
  gameInstallInfo:
    | LegendaryInstallInfo
    | GogInstallInfo
    | NileInstallInfo
    | ZoomInstalledInfo
    | ZoomInstallInfo
    | ItchioInstallInfo
    | null
  onClose: () => void
}

export default function ModifyInstallModal({
  gameInfo,
  gameInstallInfo,
  onClose
}: ModifyInstallProps) {
  const { t } = useTranslation()

  return (
    <Dialog
      showCloseButton
      onClose={() => onClose()}
      className={'ModifyInstall__dialog'}
    >
      <DialogHeader onClose={() => onClose()}>
        <div>{t('game.modify', 'Modify Installation')}</div>
      </DialogHeader>
      <DialogContent>
        {gameInstallInfo ? (
          <>
            {gameInfo.runner === 'gog' && (
              <GOGModifyInstallModal gameInfo={gameInfo} onClose={onClose} />
            )}
            {gameInfo.runner === 'legendary' && (
              <LegendaryModifyInstallModal
                dlcs={(gameInstallInfo as LegendaryInstallInfo)?.game.owned_dlc}
                gameInfo={gameInfo}
                onClose={onClose}
              />
            )}
          </>
        ) : (
          <UpdateComponent />
        )}
      </DialogContent>
    </Dialog>
  )
}
