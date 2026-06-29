'use client'

import { useState, useEffect, useRef } from 'react'
import type { DragEvent, ChangeEvent } from 'react'
import type { EnrichJob, EnrichRow, MadEnrichJob, MadEnrichRow } from '@/lib/supabase/types'

type Stage = 'A' | 'B'
type Branch = 'zillow' | 'mad'

// ── sub-components ─────────────────────────────────────────────────────────

function ZillowMatchBadge({ type }: { type: string | null }) {
  if (!type) {
    return (
      <span style={{ padding: '2px 8px', fontSize: 12, borderRadius: 9999, background: '#f3f4f6', color: '#9ca3af' }}>
        pending
      </span>
    )
  }
  const colors: Record<string, { bg: string; color: string }> = {
    email_company:      { bg: '#dcfce7', color: '#15803d' },
    email:              { bg: '#bbf7d0', color: '#22c55e' },
    name_team:          { bg: '#f3e8ff', color: '#a855f7' },
    website:            { bg: '#e0f2fe', color: '#0ea5e9' },
    phone_name:         { bg: '#dbeafe', color: '#3b82f6' },
    name_company_state: { bg: '#ffedd5', color: '#f97316' },
    name_fuzzy:         { bg: '#fef9c3', color: '#eab308' },
    no_match:           { bg: '#fee2e2', color: '#ef4444' },
  }
  const c = colors[type] ?? { bg: '#f3f4f6', color: '#6b7280' }
  return (
    <span style={{ padding: '2px 8px', fontSize: 12, borderRadius: 9999, background: c.bg, color: c.color }}>
      {type}
    </span>
  )
}

function MadMatchBadge({ type }: { type: string | null }) {
  if (!type) {
    return (
      <span style={{ padding: '2px 8px', fontSize: 12, borderRadius: 9999, background: '#f3f4f6', color: '#9ca3af' }}>
        pending
      </span>
    )
  }
  const colors: Record<string, { bg: string; color: string }> = {
    email:      { bg: '#dcfce7', color: '#22c55e' },
    phone:      { bg: '#dbeafe', color: '#3b82f6' },
    name_exact: { bg: '#f3e8ff', color: '#a855f7' },
    name_fuzzy: { bg: '#fef9c3', color: '#eab308' },
    no_match:   { bg: '#fee2e2', color: '#ef4444' },
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

function UploadZone({
  uploading,
  dragging,
  onDragOver,
  onDragLeave,
  onDrop,
  onClick,
  onChange,
  inputId,
  description,
}: {
  uploading: boolean
  dragging: boolean
  onDragOver: (e: DragEvent<HTMLDivElement>) => void
  onDragLeave: () => void
  onDrop: (e: DragEvent<HTMLDivElement>) => void
  onClick: () => void
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
  inputId: string
  description: string
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => !uploading && onClick()}
      className={[
        'relative flex flex-col items-center justify-center gap-3',
        'rounded-xl border-2 border-dashed p-10 cursor-pointer transition-colors duration-150',
        dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-white hover:border-gray-400',
        uploading ? 'opacity-60 cursor-not-allowed' : '',
      ].join(' ')}
    >
      <input
        id={inputId}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={onChange}
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
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <p className="font-medium text-gray-700">Drop a CSV or click to upload</p>
          <p className="text-xs text-gray-400 text-center">{description}</p>
        </>
      )}
    </div>
  )
}

// ── main page ──────────────────────────────────────────────────────────────

export default function Home() {
  const [stage, setStage]       = useState<Stage>('A')
  const [branch, setBranch]     = useState<Branch>('zillow')

  // Zillow state
  const [jobId, setJobId]       = useState<string | null>(null)
  const [job, setJob]           = useState<EnrichJob | null>(null)
  const [rows, setRows]         = useState<EnrichRow[]>([])

  // MAD state
  const [madJobId, setMadJobId] = useState<string | null>(null)
  const [madJob, setMadJob]     = useState<MadEnrichJob | null>(null)
  const [madRows, setMadRows]   = useState<MadEnrichRow[]>([])

  const [uploading, setUploading]   = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [dragging, setDragging]     = useState(false)

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current) }
  }, [])

  // ── Zillow polling ────────────────────────────────────────────────────────

  function startZillowPolling(id: string) {
    async function tick() {
      try {
        const res  = await fetch(`/api/enrich/status/${id}?t=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        })
        const json = await res.json()
        if (!json.data) return
        setJob({ ...json.data.job })
        setRows([...json.data.rows])
        const isDone = json.data.job.stage1_status === 'done'
          || json.data.job.stage1_status === 'error'
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

  // ── MAD polling ───────────────────────────────────────────────────────────

  function startMadPolling(id: string) {
    async function tick() {
      try {
        const res  = await fetch(`/api/mad/status/${id}?t=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' },
        })
        const json = await res.json()
        if (!json.data) return
        setMadJob({ ...json.data.job })
        setMadRows([...json.data.rows])
        const isDone = json.data.job.status === 'done'
          || json.data.job.status === 'error'
        if (!isDone) {
          timeoutRef.current = setTimeout(tick, 2000)
        }
      } catch (e) {
        console.error('mad poll error', e)
        timeoutRef.current = setTimeout(tick, 3000)
      }
    }
    tick()
  }

  // ── derived state ─────────────────────────────────────────────────────────

  const totalRows     = job?.total_rows ?? 0
  const matchedCount  = job?.stage1_matched ?? 0
  const stage1Done    = job?.stage1_status === 'done'
  const stage1Running = job?.stage1_status === 'running'
  const progressPct   = totalRows > 0
    ? Math.min(100, Math.round((matchedCount / totalRows) * 100))
    : 0

  const madTotal      = madJob?.total_rows ?? 0
  const madMatched    = madJob?.matched ?? 0
  const madDone       = madJob?.status === 'done'
  const madRunning    = madJob?.status === 'running'
  const madProgressPct = madTotal > 0
    ? Math.min(100, Math.round((madMatched / madTotal) * 100))
    : 0

  // ── handlers ─────────────────────────────────────────────────────────────

  async function handleZillowFile(file: File) {
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
      setBranch('zillow')
      setStage('B')
      startZillowPolling(newJobId)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function handleMadFile(file: File) {
    setUploading(true)
    setError(null)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res  = await fetch('/api/mad/upload', { method: 'POST', body: formData })
      const json = (await res.json()) as { data?: { job_id: string }; error?: string }
      if (!res.ok || json.error) throw new Error(json.error ?? 'Upload failed')
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      const newJobId = json.data!.job_id
      setMadJob(null)
      setMadRows([])
      setMadJobId(newJobId)
      setBranch('mad')
      setStage('B')
      startMadPolling(newJobId)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  function onZillowInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleZillowFile(file)
    e.target.value = ''
  }

  function onMadInputChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleMadFile(file)
    e.target.value = ''
  }

  const [draggingZillow, setDraggingZillow] = useState(false)
  const [draggingMad, setDraggingMad]       = useState(false)

  function resetToUpload() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setStage('A')
    setJobId(null)
    setJob(null)
    setRows([])
    setMadJobId(null)
    setMadJob(null)
    setMadRows([])
    setError(null)
    setDragging(false)
    setDraggingZillow(false)
    setDraggingMad(false)
  }

  // ── Stage A — two-card upload screen ─────────────────────────────────────

  if (stage === 'A') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="w-full max-w-3xl">
          <h1 className="text-2xl font-semibold text-gray-800 mb-1">Enrich</h1>
          <p className="text-sm text-gray-500 mb-6">
            Choose a lookup pipeline, then upload a CSV.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

            {/* Zillow card */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 20 }}>🏠</span>
                <div>
                  <p className="font-semibold text-gray-800 text-sm">Zillow Lookup</p>
                  <p className="text-xs text-gray-400">Find Zillow URLs and agent profiles</p>
                </div>
              </div>
              <UploadZone
                uploading={uploading}
                dragging={draggingZillow}
                onDragOver={(e) => { e.preventDefault(); setDraggingZillow(true) }}
                onDragLeave={() => setDraggingZillow(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDraggingZillow(false)
                  const file = e.dataTransfer.files[0]
                  if (file) handleZillowFile(file)
                }}
                onClick={() => document.getElementById('file-input-zillow')?.click()}
                onChange={onZillowInputChange}
                inputId="file-input-zillow"
                description="Expected: Name, Email, Phone, Location, Website, Company"
              />
            </div>

            {/* MAD card */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 20 }}>👥</span>
                <div>
                  <p className="font-semibold text-gray-800 text-sm">MAD Lookup</p>
                  <p className="text-xs text-gray-400">Find team name, website, domain from MAD agents</p>
                </div>
              </div>
              <UploadZone
                uploading={uploading}
                dragging={draggingMad}
                onDragOver={(e) => { e.preventDefault(); setDraggingMad(true) }}
                onDragLeave={() => setDraggingMad(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDraggingMad(false)
                  const file = e.dataTransfer.files[0]
                  if (file) handleMadFile(file)
                }}
                onClick={() => document.getElementById('file-input-mad')?.click()}
                onChange={onMadInputChange}
                inputId="file-input-mad"
                description="Expected: Name, Email, Phone, Location, Website, Company"
              />
            </div>
          </div>

          {error && <ErrorBanner message={error} />}
        </div>
      </main>
    )
  }

  // ── Stage B — MAD results ─────────────────────────────────────────────────

  if (branch === 'mad') {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-5xl mx-auto">

          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-semibold text-gray-800">MAD Agent Lookup</h1>
              <p className="text-sm text-gray-400 mt-0.5">{madJob?.filename ?? '—'}</p>
            </div>
            <button onClick={resetToUpload} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              ← New upload
            </button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
            <div className="flex items-center justify-between mb-2">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="text-sm font-medium text-gray-700">Progress</span>
                <button
                  onClick={async () => {
                    if (!madJobId) return
                    const res  = await fetch(`/api/mad/status/${madJobId}?t=${Date.now()}`, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
                    const json = await res.json()
                    if (json?.data?.job) { setMadJob({ ...json.data.job }); setMadRows([...json.data.rows]) }
                  }}
                  style={{ padding: '2px 10px', fontSize: 12, background: 'none', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', color: '#6b7280' }}
                >
                  ↻ Refresh
                </button>
              </div>
              <span className="text-sm text-gray-500">{madMatched} / {madTotal} matched</span>
            </div>

            <div style={{ width: '100%', background: '#e5e7eb', borderRadius: 9999, height: 8 }}>
              <div style={{ width: `${madProgressPct}%`, background: '#3b82f6', borderRadius: 9999, height: 8, transition: 'width 0.3s' }} />
            </div>

            {madJob?.status === 'error' && (
              <ErrorBanner message="MAD lookup encountered an error. Check server logs." />
            )}
            {madRunning && (
              <p className="mt-3 text-xs text-gray-400">Processing rows in batches of 10…</p>
            )}
            {madDone && (
              <div className="mt-4 flex gap-3 flex-wrap">
                <a
                  href={`/api/mad/export/${madJobId}`}
                  download
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
                >
                  ↓ Download MAD CSV
                </a>
                <button
                  onClick={resetToUpload}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  ↺ New upload
                </button>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                  <tr>
                    {['#', 'Name', 'Email', 'Location', 'Match Type', 'Team Name', 'Team Website', 'Team Zillow URL', 'Brokerage', 'Transactions (12m)'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {madRows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-gray-400 text-sm">
                        Waiting for rows…
                      </td>
                    </tr>
                  ) : (
                    madRows.map(row => {
                      const p = row.mad_profile as Record<string, unknown>
                      const completed = row.completed_at !== null
                      return (
                        <tr key={row.id} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 text-gray-400 tabular-nums">{row.row_index + 1}</td>
                          <td className="px-4 py-2.5 text-gray-700 max-w-[160px] truncate">{row.name ?? '—'}</td>
                          <td className="px-4 py-2.5 text-gray-500 max-w-[200px] truncate">{row.email ?? '—'}</td>
                          <td className="px-4 py-2.5 text-gray-500 max-w-[140px] truncate">{row.location ?? '—'}</td>
                          <td className="px-4 py-2.5">
                            <MadMatchBadge type={completed ? (row.match_type ?? 'no_match') : null} />
                          </td>
                          <td className="px-4 py-2.5 text-gray-500 max-w-[160px] truncate">
                            {completed ? String(p['team_name'] ?? '—') : '—'}
                          </td>
                          <td className="px-4 py-2.5 max-w-[180px] truncate">
                            {completed && p['team_website'] ? (
                              <a href={String(p['team_website'])} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs">
                                {String(p['team_website'])}
                              </a>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 max-w-[180px] truncate">
                            {completed && p['team_zillow_url'] ? (
                              <a href={String(p['team_zillow_url'])} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs">
                                {String(p['team_zillow_url']).replace('https://www.zillow.com/profile/', '')}
                              </a>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-gray-500 max-w-[160px] truncate">
                            {completed ? String(p['brokerage_name'] ?? '—') : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-gray-500 tabular-nums">
                            {completed ? String(p['transactions_last_12m'] ?? '—') : '—'}
                          </td>
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

  // ── Stage B — Zillow results ──────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-800">Finding Zillow URLs</h1>
            <p className="text-sm text-gray-400 mt-0.5">{job?.filename ?? '—'}</p>
          </div>
          <button onClick={resetToUpload} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
            ← New upload
          </button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="text-sm font-medium text-gray-700">Progress</span>
              <button
                onClick={async () => {
                  if (!jobId) return
                  const res  = await fetch(`/api/enrich/status/${jobId}?t=${Date.now()}`, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } })
                  const json = await res.json()
                  if (json?.data?.job) { setJob({ ...json.data.job }); setRows([...json.data.rows]) }
                }}
                style={{ padding: '2px 10px', fontSize: 12, background: 'none', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', color: '#6b7280' }}
              >
                ↻ Refresh
              </button>
            </div>
            <span className="text-sm text-gray-500">{matchedCount} / {totalRows} matched</span>
          </div>

          <div style={{ width: '100%', background: '#e5e7eb', borderRadius: 9999, height: 8 }}>
            <div style={{ width: `${progressPct}%`, background: '#3b82f6', borderRadius: 9999, height: 8, transition: 'width 0.3s' }} />
          </div>

          {job?.stage1_status === 'error' && (
            <ErrorBanner message="Stage 1 encountered an error. Check server logs." />
          )}
          {stage1Running && (
            <p className="mt-3 text-xs text-gray-400">Processing rows in batches of 10…</p>
          )}
          {stage1Done && (
            <div className="mt-4 flex gap-3 flex-wrap">
              <a
                href={`/api/enrich/export/${jobId}`}
                download
                className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
              >
                ↓ Download CSV
              </a>
              <button
                onClick={resetToUpload}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                ↺ New upload
              </button>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                <tr>
                  {['#', 'Name', 'Email', 'Location', 'Company', 'Zillow URL', 'Match', 'Rating', 'Sales (12M)', 'Team', 'Is Team'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-gray-400 text-sm">
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
                        <td className="px-4 py-2.5 text-gray-400 tabular-nums">{row.row_index + 1}</td>
                        <td className="px-4 py-2.5 text-gray-700 max-w-[160px] truncate">{row.name ?? '—'}</td>
                        <td className="px-4 py-2.5 text-gray-500 max-w-[200px] truncate">{row.email ?? '—'}</td>
                        <td className="px-4 py-2.5 text-gray-500 max-w-[140px] truncate">{row.location ?? '—'}</td>
                        <td className="px-4 py-2.5 text-gray-500 max-w-[160px] truncate">{row.company ?? '—'}</td>
                        <td className="px-4 py-2.5 max-w-[200px] truncate">
                          {row.zillow_url ? (
                            <a href={row.zillow_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs">
                              {zillowLabel}
                            </a>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <ZillowMatchBadge type={completed ? (row.match_type ?? 'no_match') : null} />
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
