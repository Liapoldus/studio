import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { ProductInfo } from '../../frontend/src/api/info.ts'

await test('independent web binary serves embedded UI and ENV-only shell', { timeout: 120_000 }, async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const sandbox = await mkdtemp(join(tmpdir(), 'studio-web-'))
  try {
    const binary = join(sandbox, 'studio-web')
    const env = { ...process.env, GOWORK: 'off', GOFLAGS: '-p=1' }
    execFileSync('go', ['build', '-o', binary, './cmd/web'], { cwd: root, env, stdio: 'inherit' })
    for (const [endpoint, args] of [['http://core.test', []], ['https://core.test', ['-config', 'removed.json']]] as const) {
      assert.throws(() => execFileSync(binary, args, {
        cwd: sandbox, env: { ...env, STUDIO_CORE_ENDPOINT: endpoint }, stdio: 'pipe',
      }))
    }
    const reservation = createServer()
    reservation.listen(0, '127.0.0.1')
    await once(reservation, 'listening')
    const address = reservation.address()
    assert.ok(address && typeof address !== 'string')
    const listener = `127.0.0.1:${String(address.port)}`
    const closed = once(reservation, 'close')
    reservation.close()
    await closed
    const child = spawn(binary, [], {
      cwd: sandbox,
      env: { ...env, STUDIO_CORE_ENDPOINT: 'https://core.example.test', STUDIO_WEB_LISTEN_ADDRESS: listener },
      stdio: 'ignore',
    })
    const exited = new Promise<void>((resolveExit, rejectExit) => {
      child.once('error', rejectExit)
      child.once('exit', () => { resolveExit() })
    })
    try {
      const base = `http://${listener}`
      let healthy = false
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          const response = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1000) })
          await response.arrayBuffer()
          healthy = response.status === 204
        } catch {
          assert.equal(child.exitCode, null, 'web process exited during startup')
        }
        if (healthy) break
        await setTimeout(50)
      }
      assert.ok(healthy, 'web binary did not become healthy')
      const response = await fetch(`${base}/api/v1/product-info`)
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      const info = new ProductInfo(await response.json())
      assert.equal(info.name, 'Liapoldus Studio')
      assert.equal(info.singleCoreBinding, true)
      assert.deepEqual(info.coreAccessModes, ['direct'])
      const page = await fetch(base)
      assert.equal(page.status, 200)
      const html = await page.text()
      assert.match(html, /id="root"/u)
      const asset = /src="([^"]+\.js)"/u.exec(html)?.[1]
      assert.ok(asset, 'built page has no JavaScript entrypoint')
      const script = await fetch(new URL(asset, base))
      assert.equal(script.status, 200)
      assert.ok((await script.text()).length > 0)
    } finally {
      child.kill('SIGTERM')
      await exited
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})
