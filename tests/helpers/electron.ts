/**
 * Stand-in for the `electron` module.
 *
 * `scripts/run-tests.mjs` aliases every `import … from 'electron'` to this file
 * when it bundles the suite, so the real handlers register themselves here
 * instead of into a live Electron process. Tests then call `invokeHandler` the
 * way the renderer calls `ipcRenderer.invoke`.
 */
import { mkdirSync } from 'fs'
import { basename, join } from 'path'
import { tmpdir } from 'os'

type Handler = (event: unknown, ...args: any[]) => any

const handlers = new Map<string, Handler>()

export const ipcMain = {
  handle(channel: string, handler: Handler): void {
    handlers.set(channel, handler)
  },
  removeHandler(channel: string): void {
    handlers.delete(channel)
  }
}

/** Calls a registered handler with a dummy IpcMainInvokeEvent, as the renderer would. */
export function invokeHandler(channel: string, ...args: any[]): Promise<any> {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new Error(`No handler registered for channel "${channel}"`)
  }
  return Promise.resolve(handler({} as unknown, ...args))
}

export function registeredChannels(): string[] {
  return [...handlers.keys()].sort()
}

// The runner hands every test file the same base directory but `node --test`
// runs the files in parallel processes, so each one gets its own database named
// after its bundle — otherwise they would reset each other's rows mid-test.
const base = process.env.CANAL_TEST_USERDATA ?? join(tmpdir(), 'canal-app-tests')
const userData = join(base, basename(process.argv[1] ?? 'suite', '.cjs'))
mkdirSync(userData, { recursive: true })

export const app = {
  getPath(name: string): string {
    return name === 'userData' ? userData : userData
  },
  getName: (): string => 'canal-app-tests'
}

// Never exercised by the suite — the file dialogs are user interactions — but
// the handler modules import them at load time.
export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] as string[] }),
  showSaveDialog: async () => ({ canceled: true, filePath: undefined as string | undefined })
}

export const shell = {
  openExternal: async (_url: string) => undefined
}
