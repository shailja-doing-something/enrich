'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import type { EnrichJob, EnrichRow, ColumnMapping, ColumnMappingField, GenericFormattedRow } from '@/lib/supabase/types'
import { summarizeRows, prioritizeRows } from '@/lib/enrichment/contactPrioritizer'

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

// Maps each preview row's original index to its priority tier, using the same
// classification as summarizeRows() so filter counts stay consistent with pill totals.
function buildTierMap(rows: GenericFormattedRow[]): Map<number, string> {
  const enrichRows: EnrichRow[] = rows.map((row, i) => ({
    id: String(i),
    job_id: '',
    row_index: i,
    hs_ticket_url: row.hs_ticket_url,
    raw_data: {} as Record<string, string>,
    formatted_input: row,
    enriched_data: null,
    enrichment_status: 'pending' as const,
    stage_reached: null,
    team_size_data: null,
    contact_data: null,
    branch1_status: 'pending' as const,
    branch2_status: 'pending' as const,
    merged_data: null,
    priority_tier: null,
    rejected: null,
    rejection_reason: null,
    needs_review: null,
    work_email: null,
    inferred_website: null,
    inferred_company: null,
    team_name_normalized: null,
  }))
  const prioritized = prioritizeRows(enrichRows)
  const map = new Map<number, string>()
  for (const r of prioritized) map.set(parseInt(r.id), r.priority_tier ?? 'P3')
  return map
}

export default function JobPage() {
  const params = useParams()
  const jobId = params?.jobId as string

  const [job, setJob] = useState<EnrichJob | null>(null)
  const [allRows, setAllRows] = useState<EnrichRow[]>([])
  const [confirmedLocally, setConfirmedLocally] = useState(false)
  const [approvedLocally, setApprovedLocally] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [preview, setPreview] = useState<GenericFormattedRow[] | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [networkError, setNetworkError] = useState(false)
  const [localMapping, setLocalMapping] = useState<ColumnMapping | null>(null)
  const [showAllRows, setShowAllRows] = useState(false)
  const [runningLocally, setRunningLocally] = useState(false)
  const [activePill, setActivePill] = useState<string | null>(null)

  const mountedRef = useRef(true)
  const failureCountRef = useRef(0)
  const autoRunFiredRef = useRef(false)
  const confirmedLocallyRef = useRef(false)
  const approvedLocallyRef = useRef(false)
  const localMappingInitRef = useRef(false)

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
          failureCountRef.current = 0
          setNetworkError(false)
          setJob(data)

          if (data.mapping_confirmed === true) {
            confirmedLocallyRef.current = true
            setConfirmedLocally(true)
          }

          // Note approval status without stopping the poll — pipeline continues past this
          if (data.approval_status === 'approved') {
            approvedLocallyRef.current = true
            setApprovedLocally(true)
          }

          // Prevent auto-run firing on jobs already running or complete
          if (['stage1_running', 'stage2_running', 'both_running', 'branch1_running', 'branch2_running', 'merging', 'complete'].includes(data.status)) {
            autoRunFiredRef.current = true
          }

          // Initialize localMapping once
          if (!localMappingInitRef.current && data.column_mapping) {
            localMappingInitRef.current = true
            setLocalMapping(data.column_mapping)
          }

          // Auto-run when rows are ready after user confirmed
          if (data.status === 'ready' && confirmedLocallyRef.current && !autoRunFiredRef.current) {
            autoRunFiredRef.current = true
            fetch('/api/enrich/auto-run', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jobId }),
            })
            .then(async r => {
              if (!r.ok) {
                const err = await r.json().catch(() => ({}))
                console.error('[AutoRun] Failed:', err)
                autoRunFiredRef.current = false
              } else {
                console.log('[AutoRun] Fired successfully')
                if (mountedRef.current) {
                  setJob(prev => prev ? {
                    ...prev,
                    status: 'both_running',
                    branch1_status: 'running',
                    branch2_status: 'running',
                  } : prev)
                }
              }
            })
            .catch(err => {
              console.error('[AutoRun] Network error:', err)
              autoRunFiredRef.current = false
            })
          }

          if (data.status === 'complete' && mountedRef.current) {
            fetch(`/api/enrich/jobs/${jobId}/rows`, { cache: 'no-store' })
              .then(r => r.json())
              .then(rowData => {
                if (mountedRef.current) {
                  setAllRows(rowData.data ?? rowData ?? [])
                }
              })
              .catch(() => {})
          }

          if (TERMINAL.includes(data.status)) {
            timeoutId = setTimeout(async () => {
              if (mountedRef.current) {
                try {
                  const finalRes = await fetch(`/api/enrich/status/${jobId}`, { cache: 'no-store' })
                  if (finalRes.ok && mountedRef.current) {
                    const finalData = await finalRes.json()
                    setJob(finalData)
                  }
                } catch {}
              }
            }, 1000)
          } else {
            timeoutId = setTimeout(poll, 2000)
          }
        }
      } catch {
        failureCountRef.current += 1
        if (failureCountRef.current >= 5) {
          if (mountedRef.current) setNetworkError(true)
        }
        if (mountedRef.current) timeoutId = setTimeout(poll, 5000)
      }
    }

    poll()

    return () => {
      mountedRef.current = false
      clearTimeout(timeoutId)
    }
  }, [jobId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch rows when job reaches ready or complete
  useEffect(() => {
    if (!job) return
    if (job.status !== 'ready' && job.status !== 'complete' && job.status !== 'merging') return
    fetch(`/api/enrich/jobs/${jobId}/rows`, { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        if (mountedRef.current) setAllRows(data.data ?? data ?? [])
      })
      .catch(() => {})
  }, [job?.status, jobId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch preview whenever localMapping changes (STATE B only)
  useEffect(() => {
    if (!localMapping || !job?.id) return
    if (job.status !== 'awaiting_confirmation') return

    setActivePill(null)
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

  // Lock out STATE B on first load if job is already confirmed in DB
  useEffect(() => {
    if (job?.mapping_confirmed) {
      setConfirmedLocally(true)
      confirmedLocallyRef.current = true
    }
  }, [job?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveAndRun = async () => {
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
      confirmedLocallyRef.current = true
      setConfirmedLocally(true)
      setJob(prev => prev ? { ...prev, status: 'generating', mapping_confirmed: true } : prev)
      // do NOT setSaving(false) — polling handles the transition
    } catch {
      setSaveError('Network error. Please try again.')
      setSaving(false)
    }
  }

  const handleRun = async () => {
    setRunningLocally(true)
    try {
      const res = await fetch(`/api/enrich/run/${jobId}/trigger`, { method: 'POST' })
      if (!res.ok) {
        setRunningLocally(false)
        return
      }
      setJob(prev => prev ? { ...prev, status: 'stage1_running' } : prev)
      fetch(`/api/enrich/run/${jobId}/fire`, { method: 'POST' }).catch(console.error)
    } catch {
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
  const isConfirmed = job.mapping_confirmed === true || confirmedLocally || confirmedLocallyRef.current

  // COMPLETE — STATE E
  if (status === 'complete') {
    const b1Found = allRows.filter(r => r.branch1_status === 'found')
    const b2Found = allRows.filter(r => r.branch2_status === 'found')
    const bothFound = allRows.filter(r => r.branch1_status === 'found' && r.branch2_status === 'found')
    const neitherFound = allRows.filter(r => r.branch1_status !== 'found' && r.branch2_status !== 'found')
    const displayRows = showAllRows ? allRows : allRows.slice(0, 10)
    const cell: React.CSSProperties = { padding: '0.5rem 0.75rem', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
    return (
      <div style={{ padding: '2rem' }}>
        <a href="/">← Back to dashboard</a>
        <h2 style={{ marginTop: '1rem' }}>Enrichment complete</h2>

        <div style={{ display: 'flex', gap: '1rem', marginTop: '1.25rem', flexWrap: 'wrap' }}>
          {[
            { label: 'Team size found', value: b1Found.length },
            { label: 'Contact found', value: b2Found.length },
            { label: 'Both found', value: bothFound.length },
            { label: 'Neither found', value: neitherFound.length },
          ].map(({ label, value }) => (
            <div key={label} style={{ padding: '1rem 1.25rem', border: '1px solid #e5e7eb', borderRadius: '8px', minWidth: '130px' }}>
              <p style={{ fontSize: '22px', fontWeight: 700 }}>{value}</p>
              <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '0.25rem' }}>{label}</p>
            </div>
          ))}
        </div>

        <div style={{ marginTop: '1.25rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button onClick={() => downloadCSV(
            allRows.map(r => (r.merged_data ?? {}) as Record<string, unknown>),
            `enriched-complete-${jobId}.csv`
          )}>Download all enriched ({allRows.length} rows)</button>
          <button onClick={() => downloadCSV(
            b1Found.map(r => (r.team_size_data ?? {}) as Record<string, unknown>),
            `enriched-teamsize-${jobId}.csv`
          )}>Download team size only ({b1Found.length} rows)</button>
          <button onClick={() => downloadCSV(
            b2Found.map(r => (r.contact_data ?? {}) as Record<string, unknown>),
            `enriched-contact-${jobId}.csv`
          )}>Download contact only ({b2Found.length} rows)</button>
        </div>

        <div style={{ overflowX: 'auto', marginTop: '1.5rem' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                {['Name', 'Email', 'Team size', 'Count', 'Brokerage', 'Contact source', 'Zillow rating', 'B1', 'B2'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, i) => {
                const m = row.merged_data ?? {}
                return (
                  <tr key={i} style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={cell}>{String(m.name ?? row.formatted_input?.name ?? '—')}</td>
                    <td style={cell}>{String(m.email ?? row.formatted_input?.email ?? '—')}</td>
                    <td style={cell}>{String(m.team_size_category ?? '—')}</td>
                    <td style={cell}>{String(m.team_size_count ?? '—')}</td>
                    <td style={cell}>{String(m.brokerage_enriched ?? '—')}</td>
                    <td style={cell}>{String(m.contact_source ?? '—')}</td>
                    <td style={cell}>{String(m.zillow_rating ?? '—')}</td>
                    <td style={cell}>
                      <span style={{ color: row.branch1_status === 'found' ? '#166534' : '#9ca3af' }}>
                        {row.branch1_status === 'found' ? '✓' : '✗'}
                      </span>
                    </td>
                    <td style={cell}>
                      <span style={{ color: row.branch2_status === 'found' ? '#166534' : '#9ca3af' }}>
                        {row.branch2_status === 'found' ? '✓' : '✗'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {allRows.length > 10 && (
          <button
            onClick={() => setShowAllRows(!showAllRows)}
            style={{ marginTop: '0.5rem', background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '13px' }}
          >
            {showAllRows ? 'Show fewer rows' : `View all ${allRows.length} rows`}
          </button>
        )}
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

  // PIPELINE RUNNING — STATE D
  if (['both_running', 'merging', 'stage1_running', 'stage2_running', 'branch1_running', 'branch2_running'].includes(status)) {
    const b1 = job.branch1_status ?? 'running'
    const b2 = job.branch2_status ?? 'running'
    const b1Done = b1 === 'complete'
    const b2Done = b2 === 'complete'
    return (
      <div style={{ padding: '2rem' }}>
        <a href="/">← Back to dashboard</a>
        <h2 style={{ marginTop: '1rem' }}>Enrichment running</h2>
        <p style={{ color: '#6b7280', marginTop: '0.25rem', fontSize: '13px' }}>{job.raw_row_count ?? 0} rows · both branches running in parallel</p>
        <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ padding: '1.25rem', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontWeight: 600, fontSize: '14px' }}>Branch 1 — Team Size Enrichment</p>
              <span style={{ fontSize: '13px', color: b1Done ? '#166534' : b1 === 'failed' ? '#991b1b' : '#2563eb' }}>
                {b1Done ? '✓ Complete' : b1 === 'failed' ? '✗ Failed' : '⟳ Running'}
              </span>
            </div>
            <p style={{ marginTop: '0.5rem', fontSize: '13px', color: '#6b7280' }}>
              {b1Done ? `${job.branch1_found_count ?? 0} ${job.branch1_found_count === 1 ? 'row' : 'rows'} found` : 'Submitting to n8n · polling for results…'}
            </p>
          </div>
          <div style={{ padding: '1.25rem', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontWeight: 600, fontSize: '14px' }}>Branch 2 — Contact Enrichment</p>
              <span style={{ fontSize: '13px', color: b2Done ? '#166534' : b2 === 'failed' ? '#991b1b' : '#2563eb' }}>
                {b2Done ? '✓ Complete' : b2 === 'failed' ? '✗ Failed' : '⟳ Running'}
              </span>
            </div>
            <p style={{ marginTop: '0.5rem', fontSize: '13px', color: '#6b7280' }}>
              {b2Done ? `${job.branch2_found_count ?? 0} ${job.branch2_found_count === 1 ? 'row' : 'rows'} found` : 'Zillow ZIP → mad.agents…'}
            </p>
          </div>
        </div>
        {status === 'merging' && (
          <p style={{ marginTop: '1.5rem', color: '#6b7280', fontSize: '13px' }}>⟳ Merging results…</p>
        )}
      </div>
    )
  }

  // READY — user just confirmed: show spinner while auto-run fires
  if (status === 'ready' && confirmedLocally) {
    return (
      <div style={{ padding: '2rem' }}>
        <a href="/">← Back to dashboard</a>
        <div style={{ marginTop: '4rem', textAlign: 'center' }}>
          <p>Preparing enrichment...</p>
          <p style={{ fontSize: '13px', color: '#888', marginTop: '0.5rem' }}>Starting the pipeline...</p>
        </div>
      </div>
    )
  }

  // READY — STATE C: user navigated directly — show preview and Run button
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
            style={{ background: '#2563eb', color: 'white', padding: '0.5rem 1rem', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
          >
            Run Enrichment
          </button>
        </div>
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
      </div>
    )
  }

  // GENERATING
  if (status === 'generating') {
    return (
      <div style={{ padding: '2rem' }}>
        <a href="/">← Back to dashboard</a>
        <div style={{ marginTop: '4rem', textAlign: 'center' }}>
          <p>Generating formatted sheet...</p>
          <p style={{ fontSize: '13px', color: '#888', marginTop: '0.5rem' }}>This usually takes 10–30 seconds</p>
        </div>
      </div>
    )
  }

  // APPROVED — shown as fallback when pipeline hasn't started (e.g. legacy approved jobs)
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

  // AWAITING CONFIRMATION — STATE B (mapping review; only if not yet confirmed)
  if (status === 'awaiting_confirmation' && !isConfirmed) {
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

    const FIELD_DISPLAY_ORDER: (keyof ColumnMapping)[] = [
      'name', 'email', 'phone', 'team_name', 'brokerage', 'website', 'location',
    ]
    const detectedFields = FIELD_DISPLAY_ORDER
      .filter(f => mapping[f].source_column !== null)
      .map(f => fieldLabels[f])
    const badgeLabel = `Type ${listType} — ${detectedFields.length > 0 ? detectedFields.join(' · ') : 'No fields detected'}`

    const tierMap = preview ? buildTierMap(preview) : new Map<number, string>()
    const filteredPreview = preview && activePill
      ? preview.filter((_, i) => tierMap.get(i) === activePill)
      : (preview ?? [])

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
            {badgeLabel}
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
          const pills: { tier: string; label: string; count: number; bg: string; color: string; activeBg: string; activeColor: string }[] = [
            { tier: 'P1',       label: 'P1 ready',   count: qa.p1,       bg: '#dcfce7', color: '#166534', activeBg: '#16a34a', activeColor: '#fff' },
            { tier: 'P2',       label: 'P2 partial', count: qa.p2,       bg: '#dbeafe', color: '#1e40af', activeBg: '#2563eb', activeColor: '#fff' },
            { tier: 'P3',       label: 'P3 review',  count: qa.p3,       bg: '#fef9c3', color: '#854d0e', activeBg: '#d97706', activeColor: '#fff' },
            { tier: 'Excluded', label: 'Excluded',   count: qa.excluded, bg: '#f3f4f6', color: '#6b7280', activeBg: '#4b5563', activeColor: '#fff' },
            { tier: 'Rejected', label: 'Rejected',   count: qa.rejected, bg: '#fee2e2', color: '#991b1b', activeBg: '#dc2626', activeColor: '#fff' },
          ]
          return (
            <div style={{ marginTop: '1rem' }}>
              <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '0.5rem' }}>
                Contact prioritization preview (first {qa.total} rows) · click a tier to filter
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {pills.map(({ tier, label, count, bg, color, activeBg, activeColor }) => {
                  const isActive = activePill === tier
                  const isEmpty = count === 0
                  return (
                    <span
                      key={tier}
                      onClick={() => !isEmpty && setActivePill(prev => prev === tier ? null : tier)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                        padding: '3px 10px', borderRadius: '9999px', fontSize: '12px',
                        fontWeight: 500,
                        background: isEmpty ? '#f9fafb' : isActive ? activeBg : bg,
                        color:      isEmpty ? '#d1d5db' : isActive ? activeColor : color,
                        border:     `1px solid ${isEmpty ? '#e5e7eb' : isActive ? activeBg : 'transparent'}`,
                        cursor:     isEmpty ? 'default' : 'pointer',
                        userSelect: 'none',
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>{count}</span>
                      {label}
                    </span>
                  )
                })}
              </div>
            </div>
          )
        })()}

        <div style={{ marginTop: '1.5rem' }}>
          <h3 style={{ marginBottom: '0.75rem', fontSize: '15px' }}>Preview formatted data</h3>
          {previewLoading && <p style={{ color: '#9ca3af', fontSize: '13px' }}>Loading preview...</p>}
          {!previewLoading && preview && preview.length > 0 && filteredPreview.length > 0 && (
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
                  {filteredPreview.map((row, i) => (
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
          {!previewLoading && preview && preview.length > 0 && filteredPreview.length === 0 && activePill && (
            <p style={{ color: '#9ca3af', fontSize: '13px' }}>No {activePill} rows in this preview sample.</p>
          )}
          {!previewLoading && (!preview || preview.length === 0) && localMapping && (
            <p style={{ color: '#9ca3af', fontSize: '13px' }}>No preview available</p>
          )}
        </div>

        {saveError && <p style={{ color: 'red', marginTop: '1rem' }}>{saveError}</p>}

        <button
          onClick={handleSaveAndRun}
          disabled={saving}
          style={{
            marginTop: '1.5rem', padding: '0.75rem 1.5rem',
            background: saving ? '#93c5fd' : '#2563eb', color: 'white',
            border: 'none', borderRadius: '8px', fontSize: '15px',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving...' : 'Save and run enrichment'}
        </button>
      </div>
    )
  }

  // AWAITING CONFIRMATION but mapping already confirmed in DB — stale status, show generating
  if (status === 'awaiting_confirmation' && isConfirmed) {
    return (
      <div style={{ padding: '2rem' }}>
        <a href="/">← Back to dashboard</a>
        <div style={{ marginTop: '4rem', textAlign: 'center' }}>
          <p>Generating formatted sheet...</p>
          <p style={{ fontSize: '13px', color: '#888', marginTop: '0.5rem' }}>This usually takes 10–30 seconds</p>
        </div>
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
