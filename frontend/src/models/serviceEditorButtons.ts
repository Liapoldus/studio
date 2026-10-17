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

function localized(value: unknown): { ru: string; en: string } | null {
  const item = record(value)
  if (!item || !onlyKeys(item, ['ru', 'en']) || typeof item.ru !== 'string' || typeof item.en !== 'string' || !item.ru.trim() || !item.en.trim() || item.ru.length > 2048 || item.en.length > 2048 || /[\0\r\n]/u.test(item.ru) || /[\0\r\n]/u.test(item.en)) return null
  return { ru: item.ru, en: item.en }
}
function record(value: unknown): Record<string, unknown> | null { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null }
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean { return Object.keys(value).every((key) => allowed.includes(key)) }
