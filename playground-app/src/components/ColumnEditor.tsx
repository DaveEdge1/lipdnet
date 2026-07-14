import { useState } from 'react'
import type { LipdMetadata, LipdColumn } from '../types/lipd'
import { VARIABLE_NAMES, UNITS, PROXY_TYPES, INTERP_VARIABLES, SEASONALITY } from '../lib/vocabulary'
import { InfoTip } from './InfoTip'
import { tip } from '../lib/tooltips'
import { normalizeProxy, proxyGeneralFor } from '../lib/synonyms'

// Fields with dedicated UI — excluded from the "extra fields" display
const STANDARD_COL_FIELDS = new Set([
  'number', 'variableName', 'TSid', 'units', 'description', 'proxy', 'proxyGeneral',
  'values', 'interpretation', '_synthetic', '_origNumber',
])

// Standard interpretation fields with dedicated UI
const STANDARD_INTERP_FIELDS = new Set([
  'variable', 'variableDetail', 'seasonality', 'direction', 'scope', 'basis',
])

// Suggested field names for the add-field datalist
const SUGGESTED_COL_FIELDS = [
  'calibration', 'uncertainty', 'inferredFrom', 'notes',
  'takenAtDepth', 'measurementMaterial', 'measurementTechnique',
  'hasMinValue', 'hasMaxValue', 'hasMeanValue', 'hasMedianValue', 'hasResolution',
]

interface Props {
  metadata: LipdMetadata
  selectedTSid: string | null
  onChange: (updated: LipdMetadata) => void
}

// Helper: deep clone and update a column by TSid
function updateColumn(metadata: LipdMetadata, tsid: string, updater: (col: LipdColumn) => LipdColumn): LipdMetadata {
  const clone = JSON.parse(JSON.stringify(metadata)) as LipdMetadata
  const sections = [...(metadata.paleoData ?? []), ...(metadata.chronData ?? [])]
  const cloneSections = [...(clone.paleoData ?? []), ...(clone.chronData ?? [])]
  sections.forEach((sec, si) => {
    ;(sec.measurementTable ?? []).forEach((tbl, ti) => {
      tbl.columns.forEach((col, ci) => {
        if (col.TSid === tsid) {
          cloneSections[si].measurementTable![ti].columns[ci] = updater(JSON.parse(JSON.stringify(col)))
          cloneSections[si].measurementTable![ti].columns[ci].values = col.values
        }
      })
    })
  })
  return clone
}

function findColumn(metadata: LipdMetadata, tsid: string): LipdColumn | null {
  const sections = [...(metadata.paleoData ?? []), ...(metadata.chronData ?? [])]
  for (const sec of sections) {
    for (const tbl of sec.measurementTable ?? []) {
      for (const col of tbl.columns) {
        if (col.TSid === tsid) return col
      }
    }
  }
  return null
}

export function ColumnEditor({ metadata, selectedTSid, onChange }: Props) {
  const [newFieldName, setNewFieldName] = useState('')

  if (!selectedTSid) {
    return <div className="panel column-editor empty"><p>Select a variable to edit its metadata.</p></div>
  }

  const col = findColumn(metadata, selectedTSid)
  if (!col) return <div className="panel column-editor empty"><p>Column not found.</p></div>

  const set = (key: string, value: unknown) => {
    onChange(updateColumn(metadata, selectedTSid, c => ({ ...c, [key]: value })))
  }

  // Setting a proxy autogenerates proxyGeneral (its category) from the synonyms
  // map — proxyGeneral isn't user-editable. Clears it when proxy has no match.
  const setProxy = (value: string) => {
    const pg = proxyGeneralFor(normalizeProxy(value) ?? value)
    onChange(updateColumn(metadata, selectedTSid, c => {
      const next = { ...c, proxy: value }
      if (pg) next.proxyGeneral = pg
      else delete next.proxyGeneral
      return next
    }))
  }

  const deleteField = (key: string) => {
    onChange(updateColumn(metadata, selectedTSid, c => {
      const next = { ...c }
      delete next[key]
      return next
    }))
  }

  const setInterp = (idx: number, key: string, value: unknown) => {
    onChange(updateColumn(metadata, selectedTSid, c => {
      const interps = [...(c.interpretation ?? [])]
      interps[idx] = { ...interps[idx], [key]: value }
      return { ...c, interpretation: interps }
    }))
  }

  const addInterp = () => {
    onChange(updateColumn(metadata, selectedTSid, c => ({
      ...c,
      interpretation: [...(c.interpretation ?? []), {}],
    })))
  }

  const removeInterp = (idx: number) => {
    onChange(updateColumn(metadata, selectedTSid, c => {
      const interps = [...(c.interpretation ?? [])]
      interps.splice(idx, 1)
      return { ...c, interpretation: interps.length ? interps : undefined }
    }))
  }

  const addField = () => {
    const key = newFieldName.trim()
    if (!key || STANDARD_COL_FIELDS.has(key)) return
    set(key, '')
    setNewFieldName('')
  }

  const interpretations = (col.interpretation ?? []) as Array<Record<string, unknown>>
  const extraFields = Object.entries(col).filter(([k]) => !STANDARD_COL_FIELDS.has(k))

  return (
    <div className="panel column-editor">
      <h2>{col.variableName}</h2>
      <p className="tsid-label">TSid: {col.TSid}<InfoTip text={tip('tsid')} /></p>

      <section>
        <h3>Column</h3>

        <div className="field">
          <label>Variable name<InfoTip text={tip('variableName')} /></label>
          <input list="varname-list" value={col.variableName ?? ''} onChange={e => set('variableName', e.target.value)} />
          <datalist id="varname-list">{VARIABLE_NAMES.map(v => <option key={v} value={v} />)}</datalist>
        </div>

        <div className="field">
          <label>Units<InfoTip text={tip('units')} /></label>
          <input list="units-list" value={(col.units ?? '') as string} onChange={e => set('units', e.target.value)} />
          <datalist id="units-list">{UNITS.map(v => <option key={v} value={v} />)}</datalist>
        </div>

        <div className="field">
          <label>Description<InfoTip text={tip('description')} /></label>
          <input value={(col.description ?? '') as string} onChange={e => set('description', e.target.value)} />
        </div>

        <div className="field">
          <label>Proxy<InfoTip text={tip('proxy')} /></label>
          <input list="proxy-list" value={(col.proxy ?? '') as string} onChange={e => setProxy(e.target.value)} />
          <datalist id="proxy-list">{PROXY_TYPES.map(v => <option key={v} value={v} />)}</datalist>
          {col.proxyGeneral ? <span className="field-derived">proxy category: {col.proxyGeneral as string}</span> : null}
        </div>
        {/* proxyGeneral is derived from proxy (autogenerated), so it is not edited here */}
      </section>

      {interpretations.map((interp, idx) => (
        <section key={idx} className="interp-section">
          <div className="section-header-row">
            <h3>Interpretation {interpretations.length > 1 ? idx + 1 : ''}</h3>
            <button className="btn-remove-interp" onClick={() => removeInterp(idx)} title="Remove interpretation">×</button>
          </div>

          <div className="field">
            <label>Variable<InfoTip text={tip('interp.variable')} /></label>
            <select value={(interp.variable ?? '') as string} onChange={e => setInterp(idx, 'variable', e.target.value)}>
              <option value="">— none —</option>
              {INTERP_VARIABLES.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          <div className="field">
            <label>Variable detail<InfoTip text={tip('interp.variableDetail')} /></label>
            <input value={(interp.variableDetail ?? '') as string} onChange={e => setInterp(idx, 'variableDetail', e.target.value)} />
          </div>

          <div className="field">
            <label>Seasonality<InfoTip text={tip('interp.seasonality')} /></label>
            <select value={(interp.seasonality ?? '') as string} onChange={e => setInterp(idx, 'seasonality', e.target.value)}>
              <option value="">— none —</option>
              {SEASONALITY.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          <div className="field">
            <label>Direction<InfoTip text={tip('interp.direction')} /></label>
            <select value={(interp.direction ?? '') as string} onChange={e => setInterp(idx, 'direction', e.target.value)}>
              <option value="">— none —</option>
              <option value="positive">positive</option>
              <option value="negative">negative</option>
            </select>
          </div>

          <div className="field">
            <label>Scope<InfoTip text={tip('interp.scope')} /></label>
            <select value={(interp.scope ?? '') as string} onChange={e => setInterp(idx, 'scope', e.target.value)}>
              <option value="">— none —</option>
              <option value="climate">climate</option>
              <option value="isotope">isotope</option>
            </select>
          </div>

          <div className="field">
            <label>Basis<InfoTip text={tip('interp.basis')} /></label>
            <input value={(interp.basis ?? '') as string} onChange={e => setInterp(idx, 'basis', e.target.value)} />
          </div>

          {/* Extra interpretation fields not in the standard set */}
          {Object.entries(interp)
            .filter(([k]) => !STANDARD_INTERP_FIELDS.has(k))
            .map(([k, v]) => (
              <div key={k} className="field field-extra">
                <label>{k}</label>
                <div className="field-extra-row">
                  <input value={String(v ?? '')} onChange={e => setInterp(idx, k, e.target.value)} />
                  <button className="btn-remove-field" onClick={() => {
                    onChange(updateColumn(metadata, selectedTSid, c => {
                      const interps = [...(c.interpretation ?? [])]
                      const next = { ...interps[idx] }
                      delete next[k]
                      interps[idx] = next
                      return { ...c, interpretation: interps }
                    }))
                  }} title={`Remove ${k}`}>×</button>
                </div>
              </div>
            ))}
        </section>
      ))}

      <button className="btn-add-interp" onClick={addInterp}>
        + {interpretations.length === 0 ? 'Add interpretation' : 'Add interpretation'}
      </button>

      {extraFields.length > 0 && (
        <section>
          <h3>Extra fields</h3>
          {extraFields.map(([k, v]) => (
            <div key={k} className="field field-extra">
              <label>{k}</label>
              <div className="field-extra-row">
                <input value={String(v ?? '')} onChange={e => set(k, e.target.value)} />
                <button className="btn-remove-field" onClick={() => deleteField(k)} title={`Remove ${k}`}>×</button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section>
        <h3>Add field</h3>
        <div className="add-field-row">
          <input
            list="col-fields-list"
            placeholder="Field name…"
            value={newFieldName}
            onChange={e => setNewFieldName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addField()}
          />
          <datalist id="col-fields-list">
            {SUGGESTED_COL_FIELDS.map(f => <option key={f} value={f} />)}
          </datalist>
          <button className="btn-add-field" onClick={addField}>Add</button>
        </div>
      </section>
    </div>
  )
}
