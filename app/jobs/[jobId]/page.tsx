'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import type { EnrichJob, ColumnMapping, ColumnMappingField, GenericFormattedRow } from '@/lib/supabase/types'
import { summarizeRows } from '@/lib/enrichment/contactPrioritizer'

const LIST_TYPE_META: Record<string, { label: string; bg: string; color: string }> = {
  A: { label: 'Type A — Name + Email',    bg: '#dbeafe', color: '#1e40af' },
  B: { label: 'Type B — Name only',       bg: '#ede9fe', color: '#5b21b6' },
  C: { label: 'Type C — Email only',      bg: '#e0e7ff', color: '#3730a3' },
  D: { label: 'Type D — Team name only',  bg: '#fef3c7', color: '#92400e' },
  E: { label: 'Type E — Mixed / partial', bg: '#f3f4f6', color: '#374151' },
}

function deriveListType(mapping: ColumnMapping): string {
  const hasName = mapping.name.source_column !== null
  const hasEmail = mapping.email.source_column !== null
  const hasTeamName = mapping.team_name.source_column !== null
  if (hasName && hasEmail) return 'A'
  if (hasName && !hasEmail) return 'B'
  if (hasEmail && !hasName) return 'C'
  if (hasTeamName && !hasName && !hasEmail) return 'D'
  return 'E'
}

export default function JobPage() {
  const params = useParams()
  const jobId = params?.jobId as string

  const [job, setJob] = useState<EnrichJob | null>(null)
  const [confirmedLocally, setConfirmedLocally] = useState(false)
  const [approvedLocally, setApprovedLocally] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [preview, setPreview] = useState<GenericFormattedRow[] | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [networkError, setNetworkError] = useState(false)
  const [localMapping, setLocalMapping] = useState<ColumnMapping | null>(null)

  const mountedRef = useRef(true)
  const failureCountRef = useRef(0)
  const confirmedLocallyRef = useRef(false)
  const approvedLocallyRef = useRef(false)
  const localMappingInitRef = useRef(false)

  // Polling — stops on 'failed' or when job is approved
  useEffect(() => {
    mountedRef.current = true
    let timeoutId: NodeJS.Timeout

    const poll = async () => {
      try {
        const res = await fetch(`/api/enrich/status/${jobId}`, { cache: 'no-store' })
        if (!res.ok) {
          if (mountedRef.current) timeoutId = setTimeout(poll, 2000)
          return
        }
        const data = await res.json()
        if (mountedRef.current) {
          failureCountRef.current = 0
          setNetworkError(false)
          setJob(data)

          if (data.mapping_confirmed === true) {
            confirmedLocallyRef.current = true
            setConfirmedLocally(true)
          }

          // Stop polling once the job is approved — no further steps to track
          if (data.approval_status === 'approved') {
            approvedLocallyRef.current = true
            setApprovedLocally(true)
            return
          }

          // Initialize localMapping once from DB
          if (!localMappingInitRef.current && data.column_mapping) {
            localMappingInitRef.current = true
            setLocalMapping(data.column_mapping)
          }

          if (data.status === 'failed') {
            timeoutId = setTimeout(async () => {
              if (mountedRef.current) {
                try {
                  const finalRes = await fetch(`/api/enrich/status/${jobId}`, { cache: 'no-store' })
                  if (finalRes.ok && mountedRef.current) setJob(await finalRes.json())
                } catch {}
              }
            }, 1000)
          } else {
            timeoutId = setTimeout(poll, 2000)
          }
        }
      } catch {
        failureCountRef.current += 1
        if (failureCountRef.current >= 5 && mountedRef.current) setNetworkError(true)
        if (mountedRef.current) timeoutId = setTimeout(poll, 5000)
      }
    }

    poll()

    return () => {
      mountedRef.current = false
      clearTimeout(timeoutId)
    }
  }, [jobId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch preview whenever localMapping changes (STATE B only)
  useEffect(() => {
    if (!localMapping || !job?.id) return
    if (job.status !== 'awaiting_confirmation') return

    setPreviewLoading(true)
    fetch('/api/enrich/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: job.id, columnMapping: localMapping }),
    })
      .then(r => r.json())
      .then(data => {
        if (mountedRef.current) {
          setPreview(data.preview ?? [])
          setPreviewLoading(false)
        }
      })
      .catch(() => {
        if (mountedRef.current) setPreviewLoading(false)
      })
  }, [localMapping, job?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Prevent showing STATE B for already-confirmed jobs on first load
  useEffect(() => {
    if (job?.mapping_confirmed) {
      setConfirmedLocally(true)
      confirmedLocallyRef.current = true
    }
  }, [job?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleApproveAndSubmit = async () => {
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/enrich/save-and-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, columnMapping: localMapping }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setSaveError((err as { error?: string }).error || 'Save failed')
        setSaving(false)
        return
      }
      approvedLocallyRef.current = true
      setApprovedLocally(true)
      confirmedLocallyRef.current = true
      setConfirmedLocally(true)
      // Do NOT setSaving(false) — we transition to the approved state immediately
    } catch {
      setSaveError('Network error. Please try again.')
      setSaving(false)
    }
  }

  // ── RENDER ────────────────────────────────────────────────────────────────────

  // Loading — job not yet fetched
  if (!job) {
    return (
      <div style={{ padding: '2rem' }}>
        <a href="/">← Back to dashboard</a>
        {networkError ? (
          <div style={{ marginTop: '4rem', textAlign: 'center' }}>
            <p style={{ color: 'red' }}>Cannot reach the server. Please check your internet connection and refresh the page.</p>
            <button onClick={() => window.location.reload()} style={{ marginTop: '1rem', padding: '0.5rem 1rem' }}>Retry</button>
          </div>
        ) : (
          <div style={{ marginTop: '4rem', textAlign: 'center' }}>
            <p>Loading job data...</p>
          </div>
        )}
      </div>
    )
  }

  const status = job.status

  // APPROVED — clean handoff state, no further steps triggered
  if (approvedLocally || job.approval_status === 'approved') {
    return (
      <div style={{ padding: '2rem' }}>
        <a href="/">← Back to dashboard</a>
        <div style={{ marginTop: '3rem', maxWidth: '480px' }}>
          <p style={{ fontSize: '20px', fontWeight: 600, color: '#166534' }}>List approved.</p>
          <p style={{ marginTop: '0.5rem', color: '#374151' }}>Ready for enrichment pipeline.</p>
          <p style={{ marginTop: '1.5rem', fontSize: '13px', color: '#9ca3af' }}>
            Job ID:{' '}
            <code style={{ fontSize: '12px', background: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>
              {job.id}
            </code>
          </p>
        </div>
      </div>
    )
  }

  // FAILED
  if (status === 'failed') {
    return (
      <div style={{ padding: '2rem' }}>
        <a href="/">← Back to dashboard</a>
        <h2 style={{ color: 'red', marginTop: '1rem' }}>Job failed</h2>
        {job.error_log && (
          <pre style={{ marginTop: '1rem', background: '#fee2e2', padding: '1rem', borderRadius: '8px', whiteSpace: 'pre-wrap' }}>
            {job.error_log}
          </pre>
        )}
        <a href="/" style={{ display: 'inline-block', marginTop: '1rem' }}>Start over</a>
      </div>
    )
  }

  // AWAITING CONFIRMATION — STATE B (mapping review; only if not yet confirmed)
  if (status === 'awaiting_confirmation' && !confirmedLocally) {
    const mapping = localMapping ?? job.column_mapping

    if (!mapping) {
      return (
        <div style={{ padding: '2rem' }}>
          <a href="/">← Back to dashboard</a>
          <p style={{ color: 'red', marginTop: '1rem' }}>
            Column mapping data is missing. Please go back and upload the file again.
          </p>
        </div>
      )
    }

    const listType = deriveListType(mapping)
    const listTypeMeta = LIST_TYPE_META[listType]

    const fieldLabels: Record<string, string> = {
      name: 'Full Name', email: 'Email', phone: 'Phone',
      team_name: 'Team Name', brokerage: 'Brokerage', website: 'Website', location: 'Location',
    }

    const sourceHeaders = job.source_headers ?? []
    const mappingEntries = Object.entries(mapping) as [keyof ColumnMapping, ColumnMappingField][]
    const willBeBlank = mappingEntries.filter(([, val]) => val.source_column === null).map(([field]) => fieldLabels[field] ?? field)
    const mappedSources = mappingEntries.map(([, val]) => val.source_column).filter(Boolean)
    const ignoredSources = sourceHeaders.filter(h => !mappedSources.includes(h))

    const updateMapping = (field: keyof ColumnMapping, sourceColumn: string | null) => {
      setLocalMapping(prev => {
        if (!prev) return prev
        return { ...prev, [field]: { ...prev[field], source_column: sourceColumn } }
      })
    }

    const PREVIEW_COLS: (keyof GenericFormattedRow)[] = ['name', 'email', 'phone', 'team_name', 'brokerage', 'website', 'location']

    return (
      <div style={{ padding: '2rem' }}>
        <a href="/">← Back to dashboard</a>
        <h2 style={{ marginTop: '1rem' }}>Review Column Mapping</h2>
        <p style={{ color: '#6b7280', marginTop: '0.5rem' }}>
          Gemini detected the following mapping. You can adjust any field using the dropdown.
        </p>

        <div style={{ marginTop: '0.75rem' }}>
          <span style={{
            display: 'inline-block',
            padding: '4px 12px',
            borderRadius: '9999px',
            fontSize: '13px',
            fontWeight: 500,
            background: listTypeMeta.bg,
            color: listTypeMeta.color,
          }}>
            {listTypeMeta.label}
          </span>
        </div>

        <div style={{ overflowX: 'auto', marginTop: '1.5rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #e5e7eb' }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 500 }}>Target Field</th>
                <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 500 }}>Detected Source Column</th>
                <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 500 }}>Confidence</th>
                <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 500 }}>Override</th>
              </tr>
            </thead>
            <tbody>
              {mappingEntries.map(([field, val]) => (
                <tr key={field} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: 500 }}>{fieldLabels[field] ?? field}</td>
                  <td style={{ padding: '0.75rem 1rem', color: val.source_column ? '#111' : '#9ca3af', fontStyle: val.source_column ? 'normal' : 'italic' }}>
                    {val.source_column
                      ? (val.source_column.includes('|') ? val.source_column.replace(/\|/g, ' + ') : val.source_column)
                      : '— not found —'}
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: '4px', fontSize: '12px',
                      background: val.confidence === 'high' ? '#dcfce7' : val.confidence === 'medium' ? '#fef9c3' : '#f3f4f6',
                      color: val.confidence === 'high' ? '#166534' : val.confidence === 'medium' ? '#854d0e' : '#6b7280',
                    }}>
                      {val.confidence === 'none' ? '— not found —' : val.confidence}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <select
                      value={val.source_column ?? ''}
                      onChange={e => updateMapping(field, e.target.value || null)}
                      style={{ padding: '0.25rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px' }}
                    >
                      <option value="">— leave blank —</option>
                      {sourceHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {willBeBlank.length > 0 && (
          <div style={{ marginTop: '1rem', padding: '1rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px' }}>
            <p style={{ fontWeight: 500, color: '#92400e' }}>Will be blank in output:</p>
            <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem' }}>
              {willBeBlank.map(f => <li key={f} style={{ color: '#b45309' }}>{f}</li>)}
            </ul>
          </div>
        )}

        {ignoredSources.length > 0 && (
          <div style={{ marginTop: '1rem', padding: '1rem', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
            <p style={{ fontWeight: 500, color: '#374151' }}>Ignored source columns:</p>
            <p style={{ marginTop: '0.25rem', color: '#6b7280', fontSize: '13px' }}>{ignoredSources.join(', ')}</p>
          </div>
        )}

        {preview && preview.length > 0 && (() => {
          const qa = summarizeRows(preview)
          const pills: { label: string; count: number; bg: string; color: string }[] = [
            { label: 'P1 ready',   count: qa.p1,       bg: '#dcfce7', color: '#166534' },
            { label: 'P2 partial', count: qa.p2,       bg: '#dbeafe', color: '#1e40af' },
            { label: 'P3 review',  count: qa.p3,       bg: '#fef9c3', color: '#854d0e' },
            { label: 'Excluded',   count: qa.excluded, bg: '#f3f4f6', color: '#6b7280' },
            { label: 'Rejected',   count: qa.rejected, bg: '#fee2e2', color: '#991b1b' },
          ]
          return (
            <div style={{ marginTop: '1rem' }}>
              <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '0.5rem' }}>
                Contact prioritization preview (first {qa.total} rows)
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {pills.map(({ label, count, bg, color }) => (
                  <span
                    key={label}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                      padding: '3px 10px', borderRadius: '9999px', fontSize: '12px',
                      fontWeight: 500,
                      background: count === 0 ? '#f9fafb' : bg,
                      color:      count === 0 ? '#d1d5db' : color,
                      border:     `1px solid ${count === 0 ? '#e5e7eb' : 'transparent'}`,
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>{count}</span>
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )
        })()}

        <div style={{ marginTop: '1.5rem' }}>
          <h3 style={{ marginBottom: '0.75rem', fontSize: '15px' }}>Preview formatted data</h3>
          {previewLoading && <p style={{ color: '#9ca3af', fontSize: '13px' }}>Loading preview...</p>}
          {!previewLoading && preview && preview.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', border: '1px solid #e5e7eb' }}>
                <thead>
                  <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    {PREVIEW_COLS.map(k => (
                      <th key={k} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontWeight: 500, whiteSpace: 'nowrap' }}>{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      {PREVIEW_COLS.map(k => (
                        <td key={k} style={{ padding: '0.5rem 0.75rem', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row[k] || <span style={{ color: '#d1d5db' }}>—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!previewLoading && (!preview || preview.length === 0) && localMapping && (
            <p style={{ color: '#9ca3af', fontSize: '13px' }}>No preview available</p>
          )}
        </div>

        {saveError && <p style={{ color: 'red', marginTop: '1rem' }}>{saveError}</p>}

        <button
          onClick={handleApproveAndSubmit}
          disabled={saving}
          style={{
            marginTop: '1.5rem', padding: '0.75rem 1.5rem',
            background: saving ? '#93c5fd' : '#2563eb', color: 'white',
            border: 'none', borderRadius: '8px', fontSize: '15px',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Submitting...' : 'Approve and submit'}
        </button>
      </div>
    )
  }

  // PENDING / PARSING / MAPPING — fallthrough
  const statusMessages: Record<string, string> = {
    pending: 'Starting…',
    parsing: 'Fetching and reading your sheet…',
    mapping: 'Detecting column names…',
  }

  return (
    <div style={{ padding: '2rem' }}>
      <a href="/">← Back to dashboard</a>
      <div style={{ marginTop: '4rem', textAlign: 'center' }}>
        <p>{statusMessages[status] ?? 'Processing…'}</p>
      </div>
    </div>
  )
}
