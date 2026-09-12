/**
 * Keli account authentication for the Web surface.
 *
 * The app checks the user's authentication state on every launch. The stored
 * device token (issued by the Keli server's /api/harness-auth exchange, see
 * the Keli web app's lib/harness-auth.ts) is validated against KELI_WEB_URL;
 * while unauthenticated the served index is replaced by a self-contained
 * sign-in wall and the sign-in link is printed to the terminal, so nothing
 * model-facing happens before the user clicks through login or sign-up.
 *
 * The flow is the loopback half of the desktop handoff: the link carries a
 * single-use nonce and this server's port, the browser signs in with Clerk on
 * app.keli.ai, and /harness-auth there redirects back to /auth/callback here
 * with a one-time ticket. The nonce is consumed on the first attempt — matched
 * or not — so a page that guesses the port cannot sign this app into an
 * attacker's account.
 *
 * The `keliRuntime` service published here is what the bundle's patch rows
 * read (`!!js ctx.keliRuntime.…`): the OpenRouter route's narrowed model list
 * and the default model are whatever the server last delivered, so the
 * server-side allowlist reaches running installs without a client update.
 * @module @deepseek-ai/dsh-web-app/keli-auth
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
export const name = 'keli-auth'

/** Services required before the launch check can register its routes. */
export const inject = ['webServer']

/** What the server last said about this account and its model allowlist. */
export interface KeliRuntimeValues {
  /** Whether a Keli account session is established for this install. */
  authenticated: boolean
  /** The Clerk user subject; absent until first sign-in. */
  userId?: string
  /** The server-delivered model allowlist, in picker order. */
  models: string[]
  /** The model sessions default to; always a member of {@link models}. */
  defaultModel: string
}

/** Configuration. */
export interface Config {
  /** Print the sign-in link line on the terminal when signed out. */
  printLink: boolean
}

export const Config: z<Config> = z.object({
  printLink: z.boolean().default(true),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Keli account session facts for patch-row config expressions. */
    keliRuntime: KeliRuntimeValues
  }
}

/** The Keli web app the sign-in flow talks to. */
const KELI_WEB_URL = (process.env.KELI_WEB_URL ?? 'https://app.keli.ai').replace(/\/+$/u, '')
/** Upstream-contributor escape hatch: run without a Keli account. */
const AUTH_DISABLED = process.env.KELI_AUTH_DISABLED === '1'
/** The local default when the server has not spoken yet (same model server-side). */
const FALLBACK_DEFAULT_MODEL = 'z-ai/glm-5.3-flash'
const FALLBACK_MODELS: readonly string[] = [FALLBACK_DEFAULT_MODEL]
/** Only has to span a person clicking the link; an abandoned attempt expires. */
const STATE_TTL_MS = 5 * 60_000
/** Device-token store under the Keli home. */
const STORE_PATH = dshHomePath('harness-auth.json')
const REQUEST_TIMEOUT_MS = 10_000

interface StoredDevice {
  version: 1
  deviceToken: string
  userId: string
  expiresAt: number
}

type Status = 'pending' | 'signed-out' | 'signed-in'

/** Consume-once nonce with a TTL, exactly the desktop handoff's discipline. */
class SignInState {
  private pending: { value: string; expiresAt: number } | undefined

  mint(now = Date.now()): string {
    const value = randomBytes(32).toString('base64url')
    this.pending = { value, expiresAt: now + STATE_TTL_MS }
    return value
  }

  /** A minted, unspent, unexpired nonce is behind both the printed link and
   * the wall's link — replacing it would strand the printed one. */
  hasLive(now = Date.now()): boolean {
    return this.pending !== undefined && this.pending.expiresAt > now
  }

  /** One attempt per handoff: the nonce is spent whether or not it matches. */
  consume(supplied: string | undefined, now = Date.now()): boolean {
    const expected = this.pending
    this.pending = undefined
    if (expected === undefined || expected.expiresAt <= now || supplied === undefined) return false
    const a = Buffer.from(expected.value)
    const b = Buffer.from(supplied)
    return a.length === b.length && timingSafeEqual(a, b)
  }
}

async function readStoredDevice(): Promise<StoredDevice | undefined> {
  try {
    const raw = JSON.parse(await readFile(STORE_PATH, 'utf8')) as unknown
    if (typeof raw !== 'object' || raw === null) return undefined
    const stored = raw as Record<string, unknown>
    if (stored.version !== 1 || typeof stored.deviceToken !== 'string'
      || typeof stored.userId !== 'string' || typeof stored.expiresAt !== 'number') return undefined
    return stored as unknown as StoredDevice
  } catch {
    return undefined
  }
}

async function writeStoredDevice(stored: StoredDevice): Promise<void> {
  await mkdir(dirname(STORE_PATH), { recursive: true })
  await writeFile(STORE_PATH, `${JSON.stringify(stored, null, 2)}\n`, { flag: 'w' })
  // The device token is the machine's Keli credential; same sensitivity class
  // as the OpenRouter key in the neighboring credentials file.
  await chmod(STORE_PATH, 0o600)
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(new URL(path, `${KELI_WEB_URL}/`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`keli-auth: ${path} answered ${String(response.status)}`)
  }
  return await response.json() as unknown
}

/** The page served in place of the app while the account session is unset. */
function wallPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Keli — Sign in</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: grid;
    place-items: center; min-height: 100vh; margin: 0; background: #111214; color: #e8e8ec; }
  main { text-align: center; max-width: 26rem; padding: 0 1.5rem; }
  h1 { font-weight: 600; font-size: 1.35rem; margin: 0 0 0.5rem; }
  p { color: #9a9aa3; margin: 0 0 1.4rem; line-height: 1.5; }
  a.button { display: inline-block; background: #4f46e5; color: #fff; text-decoration: none;
    font-weight: 600; font-size: 0.95rem; padding: 0.65rem 1.6rem; border-radius: 0.6rem; }
  a.button:hover { background: #5b52ec; }
  .status { font-size: 0.8rem; color: #6f6f78; margin-top: 1.6rem; }
</style>
</head>
<body>
<main>
  <h1>Sign in to Keli</h1>
  <p>This app is tied to your Keli account. Use the link below to log in or
     sign up — the browser returns you here when it is done.</p>
  <a class="button" id="signin" href="/auth/sign-in">Log in or sign up</a>
  <p class="status" id="status">Checking your session…</p>
</main>
<script>
  const status = document.getElementById('status')
  setInterval(async () => {
    try {
      const state = await (await fetch('/auth/state')).json()
      if (state.status === 'signed-in') { location.reload(); return }
      status.textContent = state.status === 'pending'
        ? 'Connecting to Keli…'
        : 'Waiting for you to finish in the browser…'
    } catch { status.textContent = 'Cannot reach the local Keli server yet…' }
  }, 1500)
</script>
</body>
</html>`
}

function plainPage(title: string, detail: string, reloadToRoot = false): string {
  const script = reloadToRoot ? '<script>setTimeout(() => location.replace("/"), 1200)</script>' : ''
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: grid;
    place-items: center; height: 100vh; margin: 0; background: #111214; color: #e8e8ec; }
  div { text-align: center; max-width: 30rem; padding: 0 1.5rem; }
  h2 { font-weight: 600; margin: 0 0 0.4rem; }
  p { color: #9a9aa3; margin: 0; }
</style></head>
<body><div><h2>${title}</h2><p>${detail}</p>${script}</div></body></html>`
}

/** The Keli account session: launch check, sign-in wall, and `keliRuntime`. */
export class KeliAuth {
  private readonly state = new SignInState()
  private readonly runtime: KeliRuntimeValues = {
    authenticated: AUTH_DISABLED,
    models: [...FALLBACK_MODELS],
    defaultModel: FALLBACK_DEFAULT_MODEL,
  }
  private status: Status = AUTH_DISABLED ? 'signed-in' : 'pending'
  private signInUrl = ''

  constructor(private readonly ctx: Context, private readonly config: Config) {}

  /** How many times the launch check retries a failed validate before giving
   * up for this launch (the wall stays up; the user signs in again). */
  private static readonly LAUNCH_ATTEMPTS = 3
  private static readonly RETRY_DELAY_MS = 5_000

  /** Status JSON for the wall's poll. */
  private get stateJson(): unknown {
    return {
      status: this.status,
      ...(this.status === 'signed-out' ? { signInUrl: this.signInUrl } : {}),
    }
  }

  private setSignedIn(userId: string | undefined, models: unknown, defaultModel: unknown): void {
    const modelList = Array.isArray(models)
      ? models.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : []
    this.runtime.authenticated = true
    if (userId !== undefined) this.runtime.userId = userId
    if (modelList.length > 0) this.runtime.models = modelList
    if (typeof defaultModel === 'string' && modelList.includes(defaultModel)) {
      this.runtime.defaultModel = defaultModel
    }
    this.status = 'signed-in'
  }

  private mintSignInUrl(): string {
    const url = new URL('harness-auth', `${KELI_WEB_URL}/`)
    url.searchParams.set('state', this.state.mint())
    url.searchParams.set('port', String(this.ctx.webServer.port))
    this.signInUrl = url.toString()
    return this.signInUrl
  }

  /** The launch check. Resolves without throwing: a network failure is retried
   * a few times (the wall says "Connecting…") and then the install proceeds
   * signed out rather than hanging the boot. */
  private async checkOnLaunch(): Promise<void> {
    if (AUTH_DISABLED) return
    for (let attempt = 1; attempt <= KeliAuth.LAUNCH_ATTEMPTS; attempt++) {
      const stored = await readStoredDevice()
      if (stored === undefined) break
      try {
        const answer = await postJson('/api/harness-auth/validate', { deviceToken: stored.deviceToken }) as {
          valid?: unknown
          userId?: unknown
          expiresAt?: unknown
          deviceToken?: unknown
          models?: unknown
          defaultModel?: unknown
        }
        if (answer.valid !== true) break
        const next: StoredDevice = {
          version: 1,
          // Rotation: every launch re-issues the token, so a device in regular
          // use never presents one older than a single launch.
          deviceToken: typeof answer.deviceToken === 'string' ? answer.deviceToken : stored.deviceToken,
          userId: typeof answer.userId === 'string' ? answer.userId : stored.userId,
          expiresAt: typeof answer.expiresAt === 'number' ? answer.expiresAt : stored.expiresAt,
        }
        await writeStoredDevice(next)
        this.setSignedIn(next.userId, answer.models, answer.defaultModel)
        this.ctx.logger.info(`keli-auth: signed in as ${next.userId}`)
        return
      } catch (error) {
        // Offline (or the Keli web app is down): retry rather than force a
        // sign-in the user has already done.
        this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        if (attempt < KeliAuth.LAUNCH_ATTEMPTS) {
          await new Promise(resolve => setTimeout(resolve, KeliAuth.RETRY_DELAY_MS))
        }
      }
    }
    this.signedOut()
  }

  private signedOut(): void {
    const url = this.mintSignInUrl()
    this.status = 'signed-out'
    if (this.config.printLink) {
      console.log(`keli: sign in to Keli (first launch or session expired): ${url}`)
    }
  }

  /** Register the /auth routes and the index tap. */
  mount(): void {
    const ctx = this.ctx
    if (AUTH_DISABLED) return

    // While the account session is unset the served index IS the wall: the
    // app ships only after sign-in. Signed-in renders pass through untouched.
    ctx.effect(() => ctx.webServer.tapIndex(html => this.status === 'signed-in' ? html : wallPage()), 'keli-auth: index gate')

    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/auth/state',
      handler: (req, res) => { void this.serveState(req, res) },
    }), 'keli-auth: /auth/state')

    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/auth/sign-in',
      handler: (req, res) => { void this.serveSignIn(req, res) },
    }), 'keli-auth: /auth/sign-in')

    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/auth/callback',
      handler: (req, res) => { void this.serveCallback(req, res) },
    }), 'keli-auth: /auth/callback')
  }

  /**
   * Run the launch check and publish `keliRuntime` exactly once, with its
   * final values. Model rows inject this service, so their config expressions
   * resolve only after the check has spoken — the picker can never render a
   * model list older than this launch.
   */
  async runLaunchCheck(): Promise<void> {
    await this.checkOnLaunch()
    this.ctx.provide('keliRuntime', { ...this.runtime })
  }

  /** A navigation from this server's own origin, nothing else — blunts DNS
   * rebinding the same way the webserver's own fence does. */
  private sameOrigin(req: IncomingMessage): boolean {
    const host = req.headers.host ?? ''
    return /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)
  }

  private reply(res: ServerResponse, status: number, body: string, type = 'text/html; charset=utf-8'): void {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    res.end(body)
  }

  private async serveState(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.sameOrigin(req)) {
      this.reply(res, 400, plainPage('Bad request', 'This address only answers the local Keli app.'))
      return
    }
    this.reply(res, 200, JSON.stringify(this.stateJson), 'application/json')
  }

  private async serveSignIn(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.sameOrigin(req)) {
      this.reply(res, 400, plainPage('Bad request', 'This address only answers the local Keli app.'))
      return
    }
    if (this.status === 'signed-in') {
      res.writeHead(303, { 'cache-control': 'no-store', location: '/' })
      res.end()
      return
    }
    // Re-mint only when nothing live is outstanding, so the terminal's printed
    // link and this redirect stay the same handoff until one of them is used.
    if (!this.state.hasLive() || this.signInUrl === '') this.mintSignInUrl()
    res.writeHead(303, { 'cache-control': 'no-store', location: this.signInUrl })
    res.end()
  }

  private async serveCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET' || !this.sameOrigin(req)) {
      this.reply(res, 400, plainPage('Bad request', 'This address only answers the sign-in handoff.'))
      return
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const supplied = url.searchParams.get('state') ?? undefined
    const ticket = url.searchParams.get('ticket')
    // One attempt per handoff, whether or not it matches — a mismatch must not
    // leave the nonce up for another guess.
    if (!this.state.consume(supplied) || ticket === null) {
      this.reply(res, 400, plainPage("That link didn't match", 'Start sign-in again from the Keli app.'))
      this.signedOut()
      return
    }
    try {
      const answer = await postJson('/api/harness-auth/redeem', { ticket }) as {
        deviceToken?: unknown
        userId?: unknown
        expiresAt?: unknown
        models?: unknown
        defaultModel?: unknown
      }
      if (typeof answer.deviceToken !== 'string' || typeof answer.userId !== 'string') {
        throw new Error('keli-auth: redeem answer missing the device token')
      }
      await writeStoredDevice({
        version: 1,
        deviceToken: answer.deviceToken,
        userId: answer.userId,
        expiresAt: typeof answer.expiresAt === 'number' ? answer.expiresAt : 0,
      })
      this.setSignedIn(answer.userId, answer.models, answer.defaultModel)
      this.ctx.logger.info(`keli-auth: signed in as ${answer.userId}`)
      // The tab that finishes sign-in reloads into the now-unlocked app.
      this.reply(res, 200, plainPage('Signed in to Keli', 'You can close this tab — the app is opening.', true))
    } catch (error) {
      this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
      this.reply(res, 502, plainPage('Could not finish signing in', 'The Keli server did not accept the handoff. Start again from the app.'))
      this.signedOut()
    }
  }
}

/** Plugin entry: mount the account session over the active web server. */
export function apply(ctx: Context, config: Config): void {
  const auth = new KeliAuth(ctx, config)
  auth.mount()
  void auth.runLaunchCheck()
}
