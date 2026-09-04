// A tiny external store carrying the currently-open dataset's identity, so the
// NavBar's "Feedback" link (a sibling of the editor) can fold it into the
// pre-filled GitHub issue. PlaygroundView publishes on load/close; NavBar reads
// it reactively via useFeedbackDataset. Per-page-load only (routes are full
// page loads, so this resets naturally between pages).
import { useSyncExternalStore } from 'react'

export interface FeedbackDataset {
  dataSetName?: string
  datasetId?: string
  noaaStudyId?: string
  source?: string   // e.g. 'NOAA', 'PANGAEA'
}

let current: FeedbackDataset | null = null
const listeners = new Set<() => void>()

export function setFeedbackDataset(ctx: FeedbackDataset | null): void {
  current = ctx
  listeners.forEach(l => l())
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function useFeedbackDataset(): FeedbackDataset | null {
  return useSyncExternalStore(subscribe, () => current, () => null)
}
