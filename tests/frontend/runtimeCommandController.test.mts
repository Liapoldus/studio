import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RuntimeService, StudioAPI, Workspace } from '../../frontend/src/api/types.ts'
import { createStudioController } from '../../frontend/src/controllers/studioController.ts'
import { useStudioStore } from '../../frontend/src/stores/studio.ts'

const service: RuntimeService = {
  id: 'server', name: 'Server', version: '1.1.6', manifestVersion: 'studio-runtime/v1',
  servicePath: 'services/server/service.yaml', settingsPath: 'services/server/settings.json',
  settingsSchemaPath: 'schemas/server-settings.json', configured: true, problemCount: 0, linkPaths: [],
  artifact: { id: 'server', version: '1.1.6', platform: 'linux/arm64', digest: `sha256:${'a'.repeat(64)}` },
}

function workspace(): Workspace {
  return {
    project: { id: 'runtime-project', name: 'Runtime project', rootPath: '/tmp/runtime-project' },
    graph: { services: [service], links: [] },
    files: [], git: { changes: [] },
  } as unknown as Workspace
}

await test('global runtime lifecycle waits for the CLI terminal event before refreshing Core metadata', async () => {
  useStudioStore.setState({ workspace: workspace(), serviceSettingsDrafts: {}, error: null })
  const order: string[] = []
  let finishCommand!: () => void
  const api = {
    runStudioCommand: () => { order.push('fire-and-forget'); return Promise.resolve() },
    runStudioCommandAndWait: () => {
      order.push('cli-started')
      return new Promise<void>((resolve) => { finishCommand = () => { order.push('cli-terminal'); resolve() } })
    },
    readRuntimeServiceMetadata: () => { order.push('core-metadata'); return Promise.reject(new Error('service metadata is unavailable')) },
  } as unknown as StudioAPI
  const controller = createStudioController(api)

  const running = controller.run('runtime.start', 'local')
  assert.deepEqual(order, ['cli-started'])
  finishCommand()
  await running

  assert.deepEqual(order, ['cli-started', 'cli-terminal', 'core-metadata'])
  assert.equal(useStudioStore.getState().runtimeStatuses.server, 'unknown')
})
