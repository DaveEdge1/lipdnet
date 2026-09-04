import { useCallback, useState } from 'react'
import { parseLipd } from '../lib/lipd'
import type { LipdFile } from '../types/lipd'

interface Props {
  onLoad: (lipd: LipdFile) => void
}

export function DropZone({ onLoad }: Props) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback(async (file: File) => {
    setError(null)
    try {
      const lipd = await parseLipd(file)
      onLoad(lipd)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse file')
    }
  }, [onLoad])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  return (
    <div className="dropzone-wrapper">
      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="dropzone-icon">📂</div>
        <p>Drop a <code>.lpd</code> file here</p>
        <label className="btn">
          Browse
          <input
            type="file"
            accept=".lpd"
            style={{ display: 'none' }}
            onChange={onInputChange}
          />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
