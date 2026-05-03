import { LogPrefix, logDebug, logError, logInfo } from 'backend/logger'
import { EALoginData, EARegisterData, EAUserData } from 'common/types/ea'
import { runRunnerCommand } from './library'
import { existsSync, readFileSync } from 'graceful-fs'
import { configStore } from './electronStores'
import { clearCache } from 'backend/utils'
import { eaOAuthCallbackPort, eaUserData } from './constants'
import { randomBytes } from 'crypto'

// EA / Nucleus OAuth endpoints. Sourced from Maxima
// (maxima-lib/src/core/endpoints.rs).
const EA_AUTH_AUTHORIZE = 'https://accounts.ea.com/connect/auth'
// "Juno PC" client ID used by EA Desktop. Maxima ships the same default;
// users with their own Maxima setup can override via the auth subcommand.
const EA_DEFAULT_CLIENT_ID = 'JUNO_PC'

function authLogSanitizer(line: string) {
  try {
    const output = JSON.parse(line)
    output.url = '<redacted>'
    output.code_verifier = '<redacted>'
    output.client_id = '<redacted>'
    return JSON.stringify(output) + '\n'
  } catch {
    return line
  }
}

export class EAUser {
  /**
   * Returns the URL the frontend should open in a webview for the
   * Nucleus OAuth flow, plus the PKCE code_verifier. The companion
   * helper (Maxima) will be listening on `callback_port` for the
   * authorization code redirect.
   *
   * Maxima's CLI does not (yet) print this data as JSON; we wrap it
   * here and synthesize the URL ourselves. When upstream adds a
   * `--json` flag we should switch to parsing its output.
   */
  static async getLoginData(): Promise<EALoginData> {
    logDebug('Getting EA login data', LogPrefix.EA)

    // PKCE: a 96-char hex random string. Generated here so we don't
    // depend on a not-yet-shipped maxima-cli flag.
    const code_verifier = randomBytes(48).toString('hex')

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: EA_DEFAULT_CLIENT_ID,
      redirect_uri: `http://127.0.0.1:${eaOAuthCallbackPort}`,
      scope: 'basic.identity offline signin',
      code_challenge: code_verifier,
      code_challenge_method: 'plain',
      display: 'junoWeb/login'
    })

    const data: EALoginData = {
      url: `${EA_AUTH_AUTHORIZE}?${params.toString()}`,
      code_verifier,
      callback_port: eaOAuthCallbackPort,
      client_id: EA_DEFAULT_CLIENT_ID
    }

    authLogSanitizer(JSON.stringify(data))
    logInfo('EA login data prepared', LogPrefix.EA)
    return data
  }

  static async login(
    data: EARegisterData
  ): Promise<{ status: 'done' | 'failed'; user: EAUserData | undefined }> {
    logDebug(
      ['Got EA register data:', { ...data, code: '<redacted>' }],
      LogPrefix.EA
    )
    const { code, code_verifier, client_id } = data

    const { stdout, stderr, error } = await runRunnerCommand(
      [
        'create-auth-code',
        '--client-id',
        client_id,
        // The following flags don't exist in Maxima as of writing;
        // they're documented here as the contract we'd contribute
        // upstream. Maxima today reads the code from the localhost
        // callback after `juno-token-refresh` is invoked.
        '--code',
        code,
        '--code-verifier',
        code_verifier
      ],
      { abortId: 'ea-auth' }
    )

    if (error) {
      logError(['EA authentication failed:', error, stderr], LogPrefix.EA)
      return { status: 'failed', user: undefined }
    }

    // Maxima's `create-auth-code` prints "Successfully exchanged code" on
    // success. When `--json` lands upstream we'll parse stdout instead.
    const successRegex = /Successfully (exchanged|registered|logged in)/i
    if (!successRegex.test(stdout) && !successRegex.test(stderr)) {
      logError(['EA authentication failed:', stdout, stderr], LogPrefix.EA)
      return { status: 'failed', user: undefined }
    }

    logInfo('EA authentication successful', LogPrefix.EA)
    const user = await this.getUserData()
    if (!user) {
      return { status: 'failed', user: undefined }
    }
    return { status: 'done', user }
  }

  static async logout() {
    // Maxima has no `logout` subcommand; clear local token storage by
    // removing user.json, mirroring Nile's logout behaviour.
    const res = await runRunnerCommand(['juno-token-refresh', '--clear'], {
      abortId: 'ea-logout'
    }).catch(() => undefined)

    if (res?.abort) {
      logError('EA logout aborted', LogPrefix.EA)
      return
    }

    configStore.delete('userData')
    clearCache('ea')
    logInfo('Logged out of EA', LogPrefix.EA)
  }

  static async getUserData(): Promise<EAUserData | undefined> {
    if (!existsSync(eaUserData)) {
      logError('user.json does not exist', LogPrefix.EA)
      configStore.delete('userData')
      return
    }

    let parsed: {
      customer_info?: EAUserData
      pid?: { externalRefValue: string }
      persona?: { displayName?: string }
      user?: EAUserData
    }
    try {
      parsed = JSON.parse(readFileSync(eaUserData, 'utf-8'))
    } catch (error) {
      logError(['Could not parse EA user.json:', error], LogPrefix.EA)
      configStore.delete('userData')
      return
    }

    if (!Object.keys(parsed).length) {
      logInfo('user.json is empty', LogPrefix.EA)
      configStore.delete('userData')
      return
    }

    // Maxima writes raw EA Nucleus identity payload. Normalize to our
    // EAUserData shape.
    const user: EAUserData = parsed.customer_info ??
      parsed.user ?? {
        user_id: parsed.pid?.externalRefValue ?? '',
        name: parsed.persona?.displayName ?? ''
      }

    if (!user.user_id) {
      logError('EA user.json missing user_id', LogPrefix.EA)
      configStore.delete('userData')
      return
    }

    configStore.set('userData', user)
    logInfo('Saved EA user data to config', LogPrefix.EA)
    return user
  }

  public static isLoggedIn() {
    return Boolean(configStore.get_nodefault('userData'))
  }
}
