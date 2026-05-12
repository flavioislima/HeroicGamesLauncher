/**
 * Minimal JSON-RPC 2.0 client for itch.io's butlerd daemon.
 *
 * butlerd is spawned as a long-lived child process; on startup it prints a
 * single JSON line to stdout describing how to connect (TCP address, port,
 * shared secret). We then open a TCP socket, authenticate with
 * `Meta.Authenticate`, and exchange newline-terminated JSON-RPC messages.
 *
 * Reference: https://itch.io/docs/butler/launcher-integration.html
 */

import { spawn, ChildProcess } from 'child_process'
import { Socket } from 'net'

import {
  LogPrefix,
  logDebug,
  logError,
  logInfo,
  logWarning
} from 'backend/logger'

interface ButlerdHandshake {
  type: 'butlerd/listen-notification'
  time: number
  secret: string
  tcp: { address: string }
}

type JsonRpcId = number

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: JsonRpcId
  method: string
  params: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params: unknown
}

type PendingCall = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

export type NotificationHandler = (params: unknown) => void
export type RequestHandler = (params: unknown) => unknown | Promise<unknown>

export class ButlerdClient {
  private daemon?: ChildProcess
  private socket?: Socket
  private secret?: string
  private nextId = 1
  private buffer = ''
  private starting?: Promise<void>
  private readonly pending = new Map<JsonRpcId, PendingCall>()
  private readonly notificationHandlers = new Map<
    string,
    Set<NotificationHandler>
  >()
  private readonly requestHandlers = new Map<string, RequestHandler>()

  constructor(
    private readonly butlerBin: string,
    private readonly dbPath: string,
    private readonly userAgent: string
  ) {}

  start(): Promise<void> {
    if (this.starting) return this.starting
    if (this.socket) return Promise.resolve()
    this.starting = this.spawnAndConnect().catch((err) => {
      this.starting = undefined
      throw err
    })
    return this.starting
  }

  private spawnAndConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      logInfo(['Spawning butlerd:', this.butlerBin], LogPrefix.Itchio)

      const daemon = spawn(this.butlerBin, [
        'daemon',
        '--json',
        '--transport',
        'tcp',
        '--keep-alive',
        '--dbpath',
        this.dbPath,
        '--destiny-pid',
        process.pid.toString(),
        '--user-agent',
        this.userAgent
      ])
      this.daemon = daemon

      let handshakeBuffer = ''

      daemon.stdout?.on('data', (chunk: Buffer) => {
        // Once the secret is set we've completed the handshake; any further
        // stdout data is just butler being chatty and can be ignored.
        if (this.secret) return
        handshakeBuffer += chunk.toString('utf8')
        const newlineIndex = handshakeBuffer.indexOf('\n')
        if (newlineIndex === -1) return

        const line = handshakeBuffer.slice(0, newlineIndex).trim()
        handshakeBuffer = handshakeBuffer.slice(newlineIndex + 1)
        if (!line) return

        try {
          const handshake = JSON.parse(line) as ButlerdHandshake
          if (handshake.type !== 'butlerd/listen-notification') {
            logWarning(
              ['Unexpected handshake message from butlerd:', line],
              LogPrefix.Itchio
            )
            return
          }
          this.secret = handshake.secret
          this.connectTcp(handshake.tcp.address).then(resolve).catch(reject)
        } catch (err) {
          logError(
            [
              'Failed to parse butlerd handshake:',
              (err as Error).message,
              'line:',
              line
            ],
            LogPrefix.Itchio
          )
          reject(err as Error)
        }
      })

      daemon.stderr?.on('data', (chunk: Buffer) => {
        logDebug(['butlerd stderr:', chunk.toString('utf8')], LogPrefix.Itchio)
      })

      daemon.on('exit', (code, signal) => {
        logWarning(
          ['butlerd exited with code', String(code), 'signal', String(signal)],
          LogPrefix.Itchio
        )
        this.teardown(new Error(`butlerd exited (code=${code})`))
      })

      daemon.on('error', (err) => {
        logError(['butlerd spawn error:', err.message], LogPrefix.Itchio)
        reject(err)
      })
    })
  }

  private connectTcp(address: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const [host, portStr] = address.split(':')
      const port = parseInt(portStr, 10)
      if (!host || Number.isNaN(port)) {
        reject(new Error(`Invalid butlerd address: ${address}`))
        return
      }

      const socket = new Socket()
      this.socket = socket

      socket.on('data', (chunk: Buffer) => this.onSocketData(chunk))
      socket.on('error', (err) => {
        logError(['butlerd socket error:', err.message], LogPrefix.Itchio)
      })
      socket.on('close', () => {
        this.socket = undefined
      })

      socket.connect(port, host, () => {
        this.call('Meta.Authenticate', { secret: this.secret })
          .then(() => resolve())
          .catch(reject)
      })
    })
  }

  private onSocketData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8')
    let newlineIndex = this.buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)
      if (line) this.handleMessage(line)
      newlineIndex = this.buffer.indexOf('\n')
    }
  }

  private handleMessage(line: string): void {
    let msg: {
      id?: JsonRpcId
      method?: string
      params?: unknown
      result?: unknown
      error?: { code: number; message: string; data?: unknown }
    }
    try {
      msg = JSON.parse(line)
    } catch (err) {
      logError(
        ['butlerd: failed to parse message:', (err as Error).message],
        LogPrefix.Itchio
      )
      return
    }

    const hasMethod = typeof msg.method === 'string'
    const hasId = msg.id !== undefined

    // Server -> client REQUEST: has both `id` and `method`. We must respond.
    if (hasMethod && hasId) {
      this.handleServerRequest(msg.id as JsonRpcId, msg.method!, msg.params)
      return
    }

    // Response to one of our outbound calls.
    if (hasId) {
      const resolver = this.pending.get(msg.id as JsonRpcId)
      if (!resolver) return
      this.pending.delete(msg.id as JsonRpcId)
      if (msg.error) {
        resolver.reject(
          new Error(`butlerd error ${msg.error.code}: ${msg.error.message}`)
        )
      } else {
        resolver.resolve(msg.result)
      }
      return
    }

    // Server -> client NOTIFICATION (no id, no response expected).
    if (hasMethod) {
      const handlers = this.notificationHandlers.get(msg.method!)
      handlers?.forEach((handler) => {
        try {
          handler(msg.params)
        } catch (err) {
          logError(
            [
              `butlerd notification handler for ${msg.method} threw:`,
              (err as Error).message
            ],
            LogPrefix.Itchio
          )
        }
      })
    }
  }

  private handleServerRequest(
    id: JsonRpcId,
    method: string,
    params: unknown
  ): void {
    const handler = this.requestHandlers.get(method)
    if (!handler) {
      // No handler registered: send an error so butlerd doesn't hang.
      this.socket?.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `no client handler for ${method}`
          }
        }) + '\n'
      )
      return
    }
    Promise.resolve()
      .then(() => handler(params))
      .then((result) => {
        this.socket?.write(
          JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'
        )
      })
      .catch((err: Error) => {
        this.socket?.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            error: { code: -32000, message: err.message }
          }) + '\n'
        )
      })
  }

  /**
   * Send a JSON-RPC request and await its result. Subscribe to long-running
   * notifications via `on()` *before* issuing requests that emit them.
   */
  call<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    if (!this.socket) {
      return Promise.reject(
        new Error('butlerd not connected; call start() first')
      )
    }
    const id = this.nextId++
    const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject
      })
      this.socket!.write(JSON.stringify(request) + '\n')
    })
  }

  /**
   * Register a handler for a server-initiated REQUEST (e.g.
   * `PickManifestAction`). The handler's resolved value is sent back as the
   * RPC result. Only one handler per method; calling again replaces it.
   * Returns an unregister function.
   */
  handle(method: string, handler: RequestHandler): () => void {
    this.requestHandlers.set(method, handler)
    return () => {
      if (this.requestHandlers.get(method) === handler) {
        this.requestHandlers.delete(method)
      }
    }
  }

  /**
   * Register a handler for server-initiated notifications (e.g. `Progress`,
   * `TaskStarted`). Returns an unsubscribe function.
   */
  on(method: string, handler: NotificationHandler): () => void {
    let handlers = this.notificationHandlers.get(method)
    if (!handlers) {
      handlers = new Set()
      this.notificationHandlers.set(method, handlers)
    }
    handlers.add(handler)
    return () => {
      this.notificationHandlers.get(method)?.delete(handler)
    }
  }

  stop(): Promise<void> {
    this.teardown(new Error('butlerd client stopped'))
    this.daemon?.kill()
    this.daemon = undefined
    return Promise.resolve()
  }

  private teardown(reason: Error): void {
    for (const { reject } of this.pending.values()) reject(reason)
    this.pending.clear()
    this.socket?.destroy()
    this.socket = undefined
    this.secret = undefined
    this.starting = undefined
  }
}

let singleton: ButlerdClient | undefined

/**
 * Lazily start (or return) the process-wide butlerd client.
 *
 * `bin` and `dbPath` are resolved by the caller — usually via
 * `getButlerBin()` and `butlerDbPath` from constants — so this module
 * stays free of electron-app dependencies and is unit-testable.
 */
export async function getButlerdClient(
  bin: string,
  dbPath: string,
  userAgent: string
): Promise<ButlerdClient> {
  if (!singleton) {
    singleton = new ButlerdClient(bin, dbPath, userAgent)
  }
  await singleton.start()
  return singleton
}

export async function shutdownButlerdClient(): Promise<void> {
  if (!singleton) return
  await singleton.stop()
  singleton = undefined
}
