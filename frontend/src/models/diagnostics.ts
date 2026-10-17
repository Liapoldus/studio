import type { Diagnostic } from '../api/types'

export type DiagnosticGroup = { diagnostic: Diagnostic; count: number }

// Preserve the full diagnostic identity while collapsing repeated polling or
// process-exit noise into a single row with an explicit occurrence count.
export function groupDiagnostics(diagnostics: Diagnostic[]): DiagnosticGroup[] {
  const groups = new Map<string, DiagnosticGroup>()
  for (const diagnostic of diagnostics) {
    const key = JSON.stringify([
      diagnostic.schemaVersion,
      diagnostic.owner,
      diagnostic.code,
      diagnostic.severity,
      diagnostic.message,
      diagnostic.operationId ?? '',
      diagnostic.target ?? '',
    ])
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, { diagnostic, count: 1 })
      continue
    }
    existing.count += 1
    if (diagnostic.timestamp > existing.diagnostic.timestamp) existing.diagnostic = diagnostic
  }
  return [...groups.values()].sort((left, right) => right.diagnostic.timestamp.localeCompare(left.diagnostic.timestamp))
}
