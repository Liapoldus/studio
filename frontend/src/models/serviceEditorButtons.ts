export type ServiceEditorButton = { id: string; key: string; label: { ru: string; en: string }; description: { ru: string; en: string } }
export type ServiceEditorButtonCandidate = ServiceEditorButton & { serviceId: string; serviceName: string }
export type ServiceEditorBinding = { buttonId: string; pluginId: string; surfaceId: string }
export type ServiceEditorSurface = { studioPluginId: string; id: string; context: 'workspace' | 'service' }
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u

export function parseServiceEditorButtons(manifestJSON: string, expectedServiceID: string): ServiceEditorButton[] {
  if (manifestJSON.length > 262_144 || !idPattern.test(expectedServiceID)) return []
  try {
    const manifest = record(JSON.parse(manifestJSON) as unknown)
    const descriptor = record(manifest?.editorButtons)
    if (manifest?.id !== expectedServiceID || !descriptor || !onlyKeys(descriptor, ['version', 'buttons']) || descriptor.version !== 'service-editor-buttons/v1' || !Array.isArray(descriptor.buttons) || descriptor.buttons.length > 64) return []
    const seen = new Set<string>()
    const buttons: ServiceEditorButton[] = []
    for (const raw of descriptor.buttons) {
      const button = record(raw)
      const label = localized(button?.label)
      const description = localized(button?.description)
      if (!button || !onlyKeys(button, ['id', 'key', 'label', 'description']) || typeof button.key !== 'string' || !idPattern.test(button.key) || button.id !== `${expectedServiceID}.${button.key}` || !label || !description || seen.has(button.id)) return []
      seen.add(button.id)
      buttons.push({ id: button.id, key: button.key, label, description })
    }
    return buttons.sort((left, right) => left.id.localeCompare(right.id))
  } catch { return [] }
}

export function resolveServiceEditorButtons<T extends ServiceEditorSurface>(buttons: readonly ServiceEditorButton[], bindings: readonly ServiceEditorBinding[], surfaces: readonly T[]): Array<{ button: ServiceEditorButton; surface: T }> {
  return buttons.flatMap((button) => {
    const binding = bindings.find((item) => item.buttonId === button.id)
    const surface = binding ? surfaces.find((item) => item.context === 'service' && item.studioPluginId === binding.pluginId && item.id === binding.surfaceId) : undefined
    return surface ? [{ button, surface }] : []
  })
}

/** Assigns a button only when it is currently unassigned and its plugin has one eligible service page. */
export function assignSingleServiceEditorPages(buttons: readonly Pick<ServiceEditorButton, 'id'>[], bindings: readonly ServiceEditorBinding[], surfaces: readonly ServiceEditorSurface[]): ServiceEditorBinding[] {
  const next = [...bindings]
  for (const button of buttons) {
    if (next.some((binding) => binding.buttonId === button.id)) continue
    const candidates = surfaces.filter((surface) => surface.context === 'service')
    const plugins = [...new Set(candidates.map((surface) => surface.studioPluginId))]
    const matches = plugins.flatMap((pluginId) => {
      const pages = candidates.filter((surface) => surface.studioPluginId === pluginId)
      return pages.length === 1 ? [{ pluginId, surface: pages[0] }] : []
    })
    if (matches.length !== 1) continue
    const [match] = matches
    next.push({ buttonId: button.id, pluginId: match.pluginId, surfaceId: match.surface.id })
  }
  return next
}

/** Server endpoint settings belong to its service editor surface, not the generic Inspector form. */
export function serviceInspectorHiddenSettingsPaths(serviceID: string): string[] {
  return serviceID === 'server' ? ['/config/routes', '/config/listeners'] : []
}

export function serviceInspectorPathIsHidden(serviceID: string, segments: readonly string[]): boolean {
  return serviceID === 'server' && segments.length >= 2 && segments[0] === 'config' && (segments[1] === 'routes' || segments[1] === 'listeners')
}

function localized(value: unknown): { ru: string; en: string } | null {
  const item = record(value)
  if (!item || !onlyKeys(item, ['ru', 'en']) || typeof item.ru !== 'string' || typeof item.en !== 'string' || !item.ru.trim() || !item.en.trim() || item.ru.length > 2048 || item.en.length > 2048 || /[\0\r\n]/u.test(item.ru) || /[\0\r\n]/u.test(item.en)) return null
  return { ru: item.ru, en: item.en }
}
function record(value: unknown): Record<string, unknown> | null { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null }
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean { return Object.keys(value).every((key) => allowed.includes(key)) }
