import type { GameInfo } from 'common/types'

// butlerd identifies an install by `caveId`. We attach it to the in-memory
// GameInfo so uninstall / update / launch can reach the right cave without
// re-querying butlerd. Kept here so the field is typed at every call site.
export type ItchioGameInfo = GameInfo & { caveId?: string }
