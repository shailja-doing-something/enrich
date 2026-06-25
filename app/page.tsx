'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { DragEvent, ChangeEvent } from 'react'
import type { EnrichJob, EnrichRow } from '@/lib/supabase/types'

type View = 'upload' | 'stage1' | 'stage2'

interface PollData {
  job: EnrichJob
  rows: EnrichRow[]
}

// ── sub-components ─────────────────────────────────────────────────────────

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="w-full bg-gray-200 rounded-full h-2">
      <div
        className="bg-blue-500 h-2 rounded-full transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function MatchBadge({ type }: { type: string | null }) {
  if (!type) {
    return <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-400">pending</span>
  }
  const styles: Record<string, string> = {
    email:      'bg-green-100 text-green-700',
    phone:      'bg-blue-100 text-blue-700',
    name_fuzzy: 'bg-yellow-100 text-yellow-700',
    no_match:   'bg-red-100 text-red-700',
  }
  const cls = styles[type] ?? 'bg-gray-100 text-gray-500'
  return <span className={`px-2 py-0.5 text-xs rounded-full ${cls}`}>{type}</span>
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  )
}

// ── main page ──────────────────────────────────────────────────────────────

export default function Home() {
  const [view, setView]                     = useState<View>('upload')
  const [jobId, setJobId]                   = useState<string | null>(null)
  const [pollData, setPollData]             = useState<PollData | null>(null)
  const [uploading, setUploading]           = useState(false)
  const [uploadError, setUploadError]       = useState<string | null>(null)
  const [dragging, setDragging]             = useState(false)
  const [stage2Starting, setStage2Starting] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/enrich/status/${id}`, { cache: 'no-store' })
      if (!res.ok) return
      const json = (await res.json()) as { data?: PollData }
      if (json.data) setPollData(json.data)
    } catch {
      // silent — retry on next tick
    }
  }, [])

  useEffect(() => {
    if (!jobId || view === 'upload') return
    poll(jobId)
    intervalRef.current = setInterval(() => poll(jobId), 2000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [jobId, view, poll])

  async function handleFile(file: File) {
    setUploading(true)
    setUploadError(null)
    const form = new FormData()
    form.append('file', file)
    try {
      const res  = await fetch('/api/enrich/upload', { method: 'POST', body: form })
      const json = (await res.json()) as { data?: { job_id: string }; error?: string }
      if (!res.ok || json.error) {
        setUploadError(json.error ?? 'Upload failed')
        return
      }
      setJobId(json.data!.job_id)
      setPollData(null)
      setView('stage1')
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
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

  function onDragLeave() {
    setDragging(false)
  }

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
      setView('stage2')
    } finally {
      setStage2Starting(false)
    }
  }

  function resetToUpload() {
    if (intervalRef.current) clearInterval(intervalRef.current)
    setView('upload')
    setJobId(null)
    setPollData(null)
    setUploadError(null)
  }

  // ── State A — upload ───────────────────────────────────────────────────

  if (view === 'upload') {
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
            onClick={() => !uploading && fileInputRef.current?.click()}
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
              ref={fileInputRef}
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
                  Expected columns: <span className="font-mono">Name, Email, Phone, Location, Website</span>
                </p>
                <p className="text-xs text-gray-400">Extra columns are preserved in the output</p>
              </>
            )}
          </div>

          {uploadError && <ErrorBanner message={uploadError} />}
        </div>
      </main>
    )
  }

  // ── State B / C — stage 1 / stage 2 ───────────────────────────────────

  const job  = pollData?.job
  const rows = pollData?.rows ?? []

  const isStage2  = view === 'stage2'
  const stage1Done  = job?.stage1_status === 'done'
  const stage2Done  = job?.stage2_status === 'done'
  const stage1Error = job?.stage1_status === 'error'
  const stage2Error = job?.stage2_status === 'error'

  const progressValue = isStage2 ? (job?.stage2_enriched ?? 0) : (job?.stage1_matched ?? 0)
  const progressMax   = isStage2 ? (job?.stage1_matched ?? 0) : (job?.total_rows ?? 0)

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
              {progressValue} / {progressMax}{' '}
              {isStage2 ? 'enriched' : 'matched'}
            </span>
          </div>
          <ProgressBar value={progressValue} max={progressMax} />

          {!isStage2 && stage1Error && (
            <ErrorBanner message="Stage 1 encountered an error. Check server logs." />
          )}
          {isStage2 && stage2Error && (
            <ErrorBanner message="Stage 2 encountered an error. Check server logs." />
          )}

          {/* Stage 1 done: download + run stage 2 */}
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

          {/* Stage 2 done: download + restart */}
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
                  {['#', 'Name', 'Email', 'Location', 'Zillow URL', 'Match'].map(h => (
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
                      colSpan={isStage2 ? 7 : 6}
                      className="px-4 py-8 text-center text-gray-400 text-sm"
                    >
                      Waiting for rows…
                    </td>
                  </tr>
                ) : (
                  rows.map(row => (
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
                      <td className="px-4 py-2.5 max-w-[200px] truncate">
                        {row.zillow_url ? (
                          <a
                            href={row.zillow_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline text-xs"
                          >
                            {row.zillow_url}
                          </a>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <MatchBadge
                          type={row.stage1_completed_at ? (row.match_type ?? 'no_match') : null}
                        />
                      </td>
                      {isStage2 && (
                        <td className="px-4 py-2.5">
                          {row.stage2_completed_at ? (
                            <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700">
                              done
                            </span>
                          ) : row.zillow_url ? (
                            <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-400">
                              pending
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-300">
                              —
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  )
}
