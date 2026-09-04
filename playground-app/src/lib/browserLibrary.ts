// The "Saved in this browser" library: a persistent, multi-entry store for
// datasets the user explicitly keeps (distinct from the single crash-recovery
// autosave slot). Backed by the `library` object store in the shared IndexedDB
// (see lib/autosaveStore), keyed by a stable dataset id so re-saving the same
// dataset updates its entry rather than piling up duplicates.

import { openDb, LIBRARY_STORE } from './autosaveStore'
import type { LipdMetadata } from '../types/lipd'

export interface LibraryEntry {
  id: string          // stable key: dataset id (falls back to filename)
  name: string        // user-facing label
  filename: string
  metadata: LipdMetadata
  savedAt: string     // ISO timestamp
}

/** The key under which a dataset is stored, so re-saving overwrites in place. */
export function libraryKey(metadata: LipdMetadata, filename: string): string {
  return metadata.datasetId || metadata.dataSetName || filename
}

export async function listLibrary(): Promise<LibraryEntry[]> {
  const db = await openDb()
  try {
    const entries = await new Promise<LibraryEntry[]>((resolve, reject) => {
      const tx = db.transaction(LIBRARY_STORE, 'readonly')
      const req = tx.objectStore(LIBRARY_STORE).getAll()
      req.onsuccess = () => resolve((req.result as LibraryEntry[]) ?? [])
      req.onerror = () => reject(req.error)
    })
    // Newest first.
    return entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  } finally {
    db.close()
  }
}

export async function saveToLibrary(entry: LibraryEntry): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LIBRARY_STORE, 'readwrite')
      tx.objectStore(LIBRARY_STORE).put(entry, entry.id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export async function deleteFromLibrary(id: string): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LIBRARY_STORE, 'readwrite')
      tx.objectStore(LIBRARY_STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}
