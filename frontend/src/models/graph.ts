import type { LayoutPoint } from './studio'

export type GraphEdgeHandles = { sourceHandle: string; targetHandle: string }

// Route calls between the nearest facing node sides, including graphs whose
// persisted layout places a caller to the right of its target.
export function graphEdgeHandles(source: LayoutPoint, target: LayoutPoint): GraphEdgeHandles {
  return source.x <= target.x
    ? { sourceHandle: 'out-right', targetHandle: 'in-left' }
    : { sourceHandle: 'out-left', targetHandle: 'in-right' }
}
