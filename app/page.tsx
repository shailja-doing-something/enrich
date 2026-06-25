'use client'

import { useState, useEffect, useRef } from 'react'
import type { DragEvent, ChangeEvent } from 'react'
import type { EnrichJob, EnrichRow } from '@/lib/supabase/types'

type Stage = 'A' | 'B' | 'C'

// ── sub-components ─────────────────────────────────────────────────────────

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div style={{ width: '100%', background: '#e5e7eb', borderRadius: 9999, height: 8 }}>
      <div
        style={{
          width: `${pct}%`,
          background: '#3b82f6',
          borderRadius: 9999,
          height: 8,
          transition: 'width 0.3s',
        }}
      />
    </div>
  )
}

function MatchBadge({ type }: { type: string | null }) {
  if (!type) {
    return (
      <span style={{ padding: '2px 8px', fontSize: 12, borderRadius: 9999, background: '#f3f4f6', color: '#9ca3af' }}>
        pending
      </span>
    )
  }
  const colors: Record<string, { bg: string; color: string }> = {
    email:      { bg: '#dcfce7', color: '#15803d' },
    name_team:  { bg: '#f3e8ff', color: '#7e22ce' },
    name_fuzzy: { bg: '#fef9c3', color: '#a16207' },
    no_match:   { bg: '#fee2e2', color: '#b91c1c' },
  }
  const c = colors[type] ?? { bg: '#f3f4f6', color: '#6b7280' }
  return (
    <span style={{ padding: '2px 8px', fontSize: 12, borderRadius: 9999, background: c.bg, color: c.color }}>
      {type}
    </span>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div style={{ marginTop: 16, borderRadius: 8, border: '1px solid #fecaca', background: '#fef2f2', padding: '12px 16px', fontSize: 14, color: '#b91c1c' }}>
      {message}
    </div>
  )
}

// ── main page ──────────────────────────────────────────────────────────────

export default function Home() {
  const [stage, setStage]                   = useState<Stage>('A')
  const [jobId, setJobId]                   = useState<string | null>(null)
  const [job, setJob]                       = useState<EnrichJob | null>(null)
  const [rows, setRows]                     = useState<EnrichRow[]>([])
  const [uploading, setUploading]           = useState(false)
  const [error, setError]                   = useState<string | null>(null)
  const [dragging, setDragging]             = useState(false)
  const [stage2Starting, setStage2Starting] = useState(false)

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  function startPolling(id: string) {
    async function tick() {
      try {
        const res  = await fetch(`/api/enrich/status/${id}?t=${Date.now()}`)
        const json = await res.json()
        if (!json.data) return
        setJob({ ...json.data.job })
        setRows([...json.data.rows])
        const isDone = json.data.job.stage2_status === 'done'
          || json.data.job.stage2_status === 'error'
        if (!isDone) {
          timeoutRef.current = setTimeout(tick, 2000)
        }
      } catch (e) {
        console.error('poll error', e)
        timeoutRef.current = setTimeout(tick, 3000)
      }
    }
    tick()
  }

  // ── derived state ─────────────────────────────────────────────────────────

  const totalRows    = job?.total_rows ?? 0
  const matchedCount = job?.stage1_matched ?? 0
  const progressPct  = totalRows > 0
    ? Math.min(100, Math.round((matchedCount / totalRows) * 100))
    : 0
  const stage1Done   = job?.stage1_status === 'done'
  const stage2Done   = job?.stage2_status === 'done'
  const stage1Running = job?.stage1_status === 'running'

  // ── handlers ─────────────────────────────────────────────────────────────

  async function handleFile(file: File) {
    setUploading(true)
    setError(null)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res  = await fetch('/api/enrich/upload', { method: 'POST', body: formData })
      const json = (await res.json()) as { data?: { job_id: string }; error?: string }
      if (!res.ok || json.error) throw new Error(json.error ?? 'Upload failed')
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      const newJobId = json.data!.job_id
      setJob(null)
      setRows([])
      setJobId(newJobId)
      setStage('B')
      startPolling(newJobId) // call directly — do not wait for a useEffect
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(true)
  }

  function onDragLeave() { setDragging(false) }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  async function handleRunStage2() {
    if (!jobId) return
    setStage2Starting(true)
    try {
      const res  = await fetch(`/api/enrich/stage2/${jobId}`, { method: 'POST' })
      const json = (await res.json()) as { error?: string }
      if (!res.ok || json.error) {
        console.error('Stage 2 start error:', json.error)
        return
      }
      setStage('C')
      // polling continues automatically — same timeout loop, now watching stage2_status
    } finally {
      setStage2Starting(false)
    }
  }

  function resetToUpload() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setStage('A')
    setJobId(null)
    setJob(null)
    setRows([])
    setError(null)
  }

  // ── Stage A — upload ──────────────────────────────────────────────────────

  if (stage === 'A') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-lg">
          <h1 className="text-2xl font-semibold text-gray-800 mb-1">Enrich</h1>
          <p className="text-sm text-gray-500 mb-6">
            Upload a CSV to find Zillow agent profiles for each row.
          </p>

          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => !uploading && document.getElementById('file-input')?.click()}
            className={[
              'relative flex flex-col items-center justify-center gap-3',
              'rounded-xl border-2 border-dashed p-12 cursor-pointer',
              'transition-colors duration-150',
              dragging
                ? 'border-blue-400 bg-blue-50'
                : 'border-gray-300 bg-white hover:border-gray-400',
              uploading ? 'opacity-60 cursor-not-allowed' : '',
            ].join(' ')}
          >
            <input
              id="file-input"
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={onInputChange}
              disabled={uploading}
            />

            {uploading ? (
              <>
                <div className="h-8 w-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                <p className="text-sm text-gray-500">Uploading…</p>
              </>
            ) : (
              <>
                <svg className="h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                  />
                </svg>
                <p className="font-medium text-gray-700">Drop a CSV or click to upload</p>
                <p className="text-xs text-gray-400">
                  Expected columns: <span className="font-mono">Name, Email, Phone, Location, Website, Company</span>
                </p>
                <p className="text-xs text-gray-400">Extra columns are preserved in the output</p>
              </>
            )}
          </div>

          {error && <ErrorBanner message={error} />}
        </div>
      </main>
    )
  }

  // ── Stage B / C — stage 1 / stage 2 ──────────────────────────────────────

  const isStage2 = stage === 'C'

  const progressValue = isStage2 ? (job?.stage2_enriched ?? 0) : matchedCount
  const progressMax   = isStage2 ? matchedCount : totalRows

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">

        {/* header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-800">
              {isStage2 ? 'Enriching agent details' : 'Finding Zillow URLs'}
            </h1>
            <p className="text-sm text-gray-400 mt-0.5">{job?.filename ?? '—'}</p>
          </div>
          <button
            onClick={resetToUpload}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            ← New upload
          </button>
        </div>

        {/* progress card */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">
              {isStage2 ? 'Stage 2 progress' : 'Stage 1 progress'}
            </span>
            <span className="text-sm text-gray-500">
              {isStage2
                ? `${job?.stage2_enriched ?? 0} / ${matchedCount} enriched`
                : `${matchedCount} / ${totalRows} matched`}
            </span>
          </div>

          <div style={{ width: '100%', background: '#e5e7eb', borderRadius: 9999, height: 8 }}>
            <div
              style={{
                width: `${progressPct}%`,
                background: '#3b82f6',
                borderRadius: 9999,
                height: 8,
                transition: 'width 0.3s',
              }}
            />
          </div>

          {!isStage2 && job?.stage1_status === 'error' && (
            <ErrorBanner message="Stage 1 encountered an error. Check server logs." />
          )}
          {isStage2 && job?.stage2_status === 'error' && (
            <ErrorBanner message="Stage 2 encountered an error. Check server logs." />
          )}

          {!isStage2 && stage1Running && (
            <p className="mt-3 text-xs text-gray-400">Processing rows in batches of 10…</p>
          )}

          {/* Stage 1 done */}
          {!isStage2 && stage1Done && (
            <div className="mt-4 flex gap-3 flex-wrap">
              <a
                href={`/api/enrich/export/${jobId}?stage=1`}
                download
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
              >
                ↓ Download Stage 1 CSV
              </a>
              <button
                onClick={handleRunStage2}
                disabled={stage2Starting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
              >
                {stage2Starting ? 'Starting…' : 'Run Stage 2 Enrichment →'}
              </button>
            </div>
          )}

          {/* Stage 2 done */}
          {isStage2 && stage2Done && (
            <div className="mt-4 flex gap-3 flex-wrap">
              <a
                href={`/api/enrich/export/${jobId}?stage=2`}
                download
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
              >
                ↓ Download Stage 2 CSV
              </a>
              <button
                onClick={resetToUpload}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                ↺ Start new upload
              </button>
            </div>
          )}
        </div>

        {/* live row table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                <tr>
                  {['#', 'Name', 'Email', 'Location', 'Company', 'Zillow URL', 'Match', 'Rating', 'Sales (12M)', 'Team', 'Is Team'].map(h => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                  {isStage2 && (
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Stage 2
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={isStage2 ? 12 : 11}
                      className="px-4 py-8 text-center text-gray-400 text-sm"
                    >
                      Waiting for rows…
                    </td>
                  </tr>
                ) : (
                  rows.map(row => {
                    const profile    = row.zillow_profile as Record<string, unknown>
                    const zillowLabel = row.zillow_url
                      ? row.zillow_url.replace('https://www.zillow.com/profile/', '')
                      : null
                    const completed = row.stage1_completed_at !== null
                    return (
                      <tr key={row.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-gray-400 tabular-nums">
                          {row.row_index + 1}
                        </td>
                        <td className="px-4 py-2.5 text-gray-700 max-w-[160px] truncate">
                          {row.name ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 max-w-[200px] truncate">
                          {row.email ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 max-w-[140px] truncate">
                          {row.location ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 max-w-[160px] truncate">
                          {row.company ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 max-w-[200px] truncate">
                          {row.zillow_url ? (
                            <a
                              href={row.zillow_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline text-xs"
                            >
                              {zillowLabel}
                            </a>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <MatchBadge type={completed ? (row.match_type ?? 'no_match') : null} />
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 tabular-nums">
                          {completed ? String(profile['rating_average'] ?? '—') : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 tabular-nums">
                          {completed ? String(profile['sales_last_12_months'] ?? '—') : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 max-w-[140px] truncate">
                          {completed ? String(profile['team_name'] ?? '—') : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-gray-500">
                          {completed ? (profile['is_team'] ? 'Yes' : 'No') : '—'}
                        </td>
                        {isStage2 && (
                          <td className="px-4 py-2.5">
                            {row.stage2_completed_at ? (
                              <span style={{ padding: '2px 8px', fontSize: 12, borderRadius: 9999, background: '#dcfce7', color: '#15803d' }}>
                                done
                              </span>
                            ) : row.zillow_url ? (
                              <span style={{ padding: '2px 8px', fontSize: 12, borderRadius: 9999, background: '#f3f4f6', color: '#9ca3af' }}>
                                pending
                              </span>
                            ) : (
                              <span style={{ padding: '2px 8px', fontSize: 12, borderRadius: 9999, background: '#f3f4f6', color: '#d1d5db' }}>
                                —
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  )
}
