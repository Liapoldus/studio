import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type ReleaseEnvironment = Record<string, string | undefined>

export const REQUIRED_RELEASE_POLICY = {
  signatures: 'STUDIO_PLUGIN_REQUIRE_SIGNATURES',
  sandbox: 'STUDIO_PLUGIN_SANDBOX_MODE',
  trustRoots: 'STUDIO_PLUGIN_TRUST_ROOTS',
} as const

export function validateReleaseConfig(env: ReleaseEnvironment): string[] {
  const errors: string[] = []

  if (env[REQUIRED_RELEASE_POLICY.signatures] !== 'true') {
    errors.push(`${REQUIRED_RELEASE_POLICY.signatures} must be true`)
  }

  if (env[REQUIRED_RELEASE_POLICY.sandbox] !== 'required') {
    errors.push(`${REQUIRED_RELEASE_POLICY.sandbox} must be required`)
  }

  if (!env[REQUIRED_RELEASE_POLICY.trustRoots]?.trim()) {
    errors.push(`${REQUIRED_RELEASE_POLICY.trustRoots} must be set`)
  }

  return errors
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const errors = validateReleaseConfig(process.env)
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`release policy error: ${error}`)
    }
    process.exitCode = 1
  } else {
    console.log('release policy: signatures, trust roots and required sandbox are configured')
  }
}
