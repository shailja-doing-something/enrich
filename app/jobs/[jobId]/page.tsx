'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import type { EnrichJob, EnrichRow, ColumnMapping, ColumnMappingField } from '@/lib/supabase/types'

export default function JobPage() {
  const params = useParams()
  const jobId = params?.jobId as string

  const [job, setJob] = useState<EnrichJob | null>(null)
  const [confirmedLocally, setConfirmedLocally] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [runningLocally, setRunningLocally] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [allRows, setAllRows] = useState<EnrichRow[]>([])
  const [showAllRows, setShowAllRows] = useState(false)
  const [localMapping, setLocalMapping] = useState<ColumnMapping | null>(null)
  const mountedRef = useRef(true)

  // Initialize localMapping once when job column_mapping first arrives
  useEffect(() => {
    if (job?.column_mapping && !localMapping) {
      setLocalMapping(job.column_mapping)
    }
  }, [job?.column_mapping]) // eslint-disable-line react-hooks/exhaustive-deps

  // Polling — stops only on terminal status
  useEffect(() => {
    mountedRef.current = true
    let timeoutId: NodeJS.Timeout
    const TERMINAL = ['complete', 'failed']

    const poll = async () => {
      try {
        const res = await fetch(`/api/enrich/status/${jobId}`, { cache: 'no-store' })
        if (!res.ok) {
          if (mountedRef.current) timeoutId = setTimeout(poll, 2000)
          return
        }
        const data = await res.json()
        if (mountedRef.current) {
          setJob(data)
          if (!TERMINAL.includes(data.status)) {
            timeoutId = setTimeout(poll, 2000)
          }
        }
      } catch {
        if (mountedRef.current) timeoutId = setTimeout(poll, 3000)
      }
    }

    poll()

    return () => {
      mountedRef.current = false
      clearTimeout(timeoutId)
    }
  }, [jobId])

  // Fetch rows when job reaches ready or complete
  useEffect(() => {
    if (!job) return
    if (job.status !== 'ready' && job.status !== 'complete') return
    fetch(`/api/enrich/jobs/${jobId}/rows`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (mountedRef.current) setAllRows(data.data ?? data ?? [])
      })
      .catch(() => {})
  }, [job?.status, jobId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleConfirm = async () => {
    if (confirming) return
    setConfirming(true)
    setConfirmError(null)
    try {
      const columnMapping = localMapping ?? job?.column_mapping
      if (!columnMapping) {
        setConfirmError('Column mapping missing. Please go back and try again.')
        setConfirming(false)
        return
      }
      const res = await fetch('/api/enrich/confirm/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, columnMapping }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setConfirmError((err as { error?: string }).error || 'Confirmation failed')
        setConfirming(false)
        return
      }
      setConfirmedLocally(true)
      setJob(prev => prev ? { ...prev, status: 'generating', mapping_confirmed: true } : prev)
      const body = JSON.stringify({ jobId })
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon('/api/enrich/confirm/execute', new Blob([body], { type: 'application/json' }))
      } else {
        fetch('/api/enrich/confirm/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {})
      }
    } catch {
      setConfirmError('Network error. Please try again.')
      setConfirming(false)
    }
  }

  const handleRun = async () => {
    if (runningLocally) return
    setRunningLocally(true)
    setRunError(null)
    try {
      const res = await fetch(`/api/enrich/run/${jobId}/trigger`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setRunError((err as { error?: string }).error || 'Failed to start enrichment')
        setRunningLocally(false)
        return
      }
      setJob(prev => prev ? { ...prev, status: 'stage1_running' } : prev)
      fetch(`/api/enrich/run/${jobId}/fire`, { method: 'POST', keepalive: true }).catch(() => {})
    } catch {
      setRunError('Network error. Please try again.')
      setRunningLocally(false)
    }
  }

  const downloadCSV = (rows: Record<string, unknown>[], filename: string) => {
    if (!rows?.length) return
    const headers = Object.keys(rows[0])
    const lines = [
      headers.join(','),
      ...rows.map(row =>
        headers.map(h => {
          const val = String(row[h] ?? '')
          return val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val
        }).join(',')
      ),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── RENDER ────────────────────────────────────────────────────────────────────

  if (!job) {
    return (
      <div style={{ padding: '2rem' }}>
        <a href="/">← Back to dashboard</a>
        <div style={{ marginTop: '4rem', textAlign: 'center' }}>Loading...</div>
      </div>
    )
  }

  const status = job.status

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

  // COMPLETE — STATE E
  if (status === 'complete') {
    const foundRows = allRows.filter(r => r.enrichment_status === 'found')
    const notFoundRows = allRows.filter(r => r.enrichment_status === 'not_found')
    return (
      <div style={{ padding: '2rem' }}>
        <a href="/">← Back to dashboard</a>
        <h2 style={{ color: 'green', marginTop: '1rem' }}>Enrichment complete</h2>
        <p style={{ marginTop: '0.5rem' }}>Total: {allRows.length} rows</p>
        <p>Found: {job.stage1_found_count ?? 0} (Stage 1) + {job.stage2_found_count ?? 0} (Stage 2) + {job.stage3_found_count ?? 0} (Stage 3)</p>
        <p>Not found: {notFoundRows.length}</p>
        <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem' }}>
          <button onClick={() => downloadCSV(
            foundRows.map(r => r.enriched_data ?? {}),
            `enriched-found-${jobId}.csv`
          )}>Download enriched rows</button>
          <button onClick={() => downloadCSV(
            notFoundRows.map(r => (r.formatted_input ?? {}) as Record<string, unknown>),
            `enriched-notfound-${jobId}.csv`
          )}>Download not found rows</button>
        </div>
      </div>
    )
  }

  // PIPELINE RUNNING — STATE D
  if (status === 'stage1_running' || status === 'stage2_running' || status === 'stage3_running') {
    const s1Done = status === 'stage2_running' || status === 'stage3_running'
    const s2Done = status === 'stage3_running'
    return (
      <div style={{ padding: '2rem' }}>
        <a href="/">← Back to dashboard</a>
        <h2 style={{ marginTop: '1rem' }}>Running enrichment...</h2>
        <div style={{ marginTop: '1rem', lineHeight: '2' }}>
          <p>{s1Done ? '✓' : '⟳'} Stage 1 — Platform search{job.stage1_found_count != null ? ` (${job.stage1_found_count} found)` : ''}</p>
          <p>{s2Done ? '✓' : status === 'stage2_running' ? '⟳' : '○'} Stage 2 — Database lookup{job.stage2_found_count != null ? ` (${job.stage2_found_count} found)` : ''}</p>
          <p>{status === 'stage3_running' ? '⟳' : '○'} Stage 3 — Scrape enrichment{job.stage3_found_count != null ? ` (${job.stage3_found_count} found)` : ''}</p>
        </div>
      </div>
    )
  }

  // READY — STATE C
  if (status === 'ready') {
    const displayRows = showAllRows ? allRows : allRows.slice(0, 5)
    const sampleRow = allRows[0]?.formatted_input
    return (
      <div style={{ padding: '2rem' }}>
        <a href="/">← Back to dashboard</a>
        <h2 style={{ color: 'green', marginTop: '1rem' }}>
          {job.raw_row_count ?? allRows.length} rows formatted successfully
        </h2>
        <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button onClick={() => downloadCSV(
            allRows.map(r => (r.formatted_input ?? {}) as Record<string, unknown>),
            `formatted-input-${jobId}.csv`
          )}>Download formatted CSV</button>
          <button
            onClick={handleRun}
            disabled={runningLocally}
            style={{
              background: runningLocally ? '#93c5fd' : '#2563eb', color: 'white',
              padding: '0.5rem 1rem', border: 'none', borderRadius: '6px',
              cursor: runningLocally ? 'not-allowed' : 'pointer',
            }}
          >
            {runningLocally ? 'Starting...' : 'Run Enrichment'}
          </button>
        </div>
        {runError && <p style={{ color: 'red', marginTop: '0.5rem' }}>{runError}</p>}
        <div style={{ marginTop: '1.5rem' }}>
          <h3>Formatted Input ({job.raw_row_count ?? allRows.length} rows)</h3>
          {sampleRow && (
            <div style={{ overflowX: 'auto', marginTop: '0.5rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr>
                    {Object.keys(sampleRow).map(k => (
                      <th key={k} style={{ textAlign: 'left', padding: '0.5rem', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }}>{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row, i) => (
                    <tr key={i}>
                      {Object.values(row.formatted_input ?? {}).map((v, j) => (
                        <td key={j} style={{ padding: '0.5rem', borderBottom: '1px solid #f5f5f5', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {String(v ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {allRows.length > 5 && (
            <button
              onClick={() => setShowAllRows(!showAllRows)}
              style={{ marginTop: '0.5rem', background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '13px' }}
            >
              {showAllRows ? 'Show fewer rows' : `View all ${allRows.length} rows`}
            </button>
          )}
        </div>
        <div style={{ marginTop: '1.5rem', fontSize: '13px', color: '#888' }}>
          <p>Created: {new Date(job.created_at).toLocaleString()}</p>
          <p>File: {job.sheet_url}</p>
          {job.parsed_at && <p>Confirmed at: {new Date(job.parsed_at).toLocaleString()}</p>}
        </div>
      </div>
    )
  }

  // GENERATING
  if (status === 'generating') {
    return (
      <div style={{ padding: '2rem' }}>
        <a href="/">← Back to dashboard</a>
        <div style={{ marginTop: '4rem', textAlign: 'center' }}>
          <p>Generating input sheet...</p>
          <p style={{ fontSize: '13px', color: '#888', marginTop: '0.5rem' }}>This usually takes 10–30 seconds</p>
        </div>
      </div>
    )
  }

  // AWAITING CONFIRMATION — STATE B
  if (status === 'awaiting_confirmation' && !job.mapping_confirmed && !confirmedLocally) {
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

    return (
      <div style={{ padding: '2rem' }}>
        <a href="/">← Back to dashboard</a>
        <h2 style={{ marginTop: '1rem' }}>Review Column Mapping</h2>
        <p style={{ color: '#666', marginTop: '0.5rem' }}>
          Gemini detected the following mapping. You can adjust any field using the dropdown.
        </p>

        <div style={{ overflowX: 'auto', marginTop: '1.5rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
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
                    {val.source_column ?? '— not found —'}
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

        {confirmError && <p style={{ color: 'red', marginTop: '1rem' }}>{confirmError}</p>}

        <button
          onClick={handleConfirm}
          disabled={confirming}
          style={{
            marginTop: '1.5rem', padding: '0.75rem 1.5rem',
            background: confirming ? '#93c5fd' : '#2563eb', color: 'white',
            border: 'none', borderRadius: '8px', fontSize: '15px',
            cursor: confirming ? 'not-allowed' : 'pointer',
          }}
        >
          {confirming ? 'Confirming...' : 'Confirm and generate sheet'}
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
        <p>{statusMessages[status] ?? `Processing… (${status})`}</p>
      </div>
    </div>
  )
}
