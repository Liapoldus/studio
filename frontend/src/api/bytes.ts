// Wails marshals Go []byte as base64 JSON strings in some runtime versions,
// even though generated declarations type the value as number[]. Accept both
// wire representations so text documents never become NUL-filled buffers.
export function decodeWailsBytes(value: unknown): Uint8Array {
  if (typeof value === 'string') {
    const binary = atob(value)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  }
  if (Array.isArray(value) || value instanceof Uint8Array) return Uint8Array.from(value)
  throw new TypeError('Unexpected Wails byte payload')
}
