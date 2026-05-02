'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import type { EnrichJob, EnrichRow, ColumnMapping, ColumnMappingField } from '@/lib/supabase/types'

type JobWithHeaders = EnrichJob & { sourceHeaders: string[] }

// ── Shared helpers ────────────────────────────────────────────────────────────

const TARGET_FIELD_LABELS: Record<keyof ColumnMapping, string> = {
  name: 'Full Name',
  email: 'Email',
  phone: 'Phone',
  team_name: 'Team Name',
  brokerage: 'Brokerage',
  website: 'Website',
  location: 'Location',
}

const FIELD_ORDER: (keyof ColumnMapping)[] = [
  'name', 'email', 'phone', 'team_name', 'brokerage', 'website', 'location',
]

function downloadAsCSV(rows: Record<string, unknown>[], filename: string) {
  if (!rows || rows.length === 0) return
  const headers = Object.keys(rows[0])
  const csvLines = [
    headers.join(','),
    ...rows.map(row =>
      headers.map(h => {
        const val = String(row[h] ?? '')
        return val.includes(',') || val.includes('"') || val.includes('\n')
          ? `"${val.replace(/"/g, '""')}"`
          : val
      }).join(',')
    ),
  ]
  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── Small components ──────────────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: ColumnMappingField['confidence'] }) {
  const styles: Record<ColumnMappingField['confidence'], string> = {
    high: 'bg-green-100 text-green-800',
    medium: 'bg-yellow-100 text-yellow-800',
    low: 'bg-red-100 text-red-800',
    none: 'bg-gray-100 text-gray-500',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[confidence]}`}>
      {confidence === 'none' ? '— not found —' : confidence}
    </span>
  )
}

function EnrichmentStatusBadge({ status }: { status: EnrichRow['enrichment_status'] }) {
  const styles: Record<EnrichRow['enrichment_status'], string> = {
    found: 'bg-green-100 text-green-800',
    not_found: 'bg-red-100 text-red-700',
    pending: 'bg-gray-100 text-gray-500',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status]}`}>
      {status.replace('_', ' ')}
    </span>
  )
}

function Spinner({ small }: { small?: boolean }) {
  const size = small ? 'h-4 w-4' : 'h-8 w-8'
  return <div className={`animate-spin rounded-full ${size} border-b-2 border-blue-600`} />
}

function CheckIcon() {
  return (
    <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

// ── STATE A — Processing ──────────────────────────────────────────────────────

const STEPS: { label: string; activeOn: EnrichJob['status'][] }[] = [
  { label: 'Uploading CSV',            activeOn: ['pending', 'parsing'] },
  { label: 'Detecting columns',        activeOn: ['mapping'] },
  { label: 'Generating input sheets',  activeOn: ['generating'] },
]

type StepState = 'pending' | 'active' | 'done'

function stepState(stepIndex: number, status: EnrichJob['status']): StepState {
  const activeIndexMap: Partial<Record<EnrichJob['status'], number>> = {
    pending: 0, parsing: 0, mapping: 1, generating: 2,
  }
  const active = activeIndexMap[status] ?? 0
  if (stepIndex < active) return 'done'
  if (stepIndex === active) return 'active'
  return 'pending'
}

function ProcessingState({ status }: { status: EnrichJob['status'] }) {
  return (
    <div className="flex flex-col items-start max-w-sm mx-auto min-h-64 justify-center gap-4 py-10">
      {STEPS.map((step, i) => {
        const state = stepState(i, status)
        return (
          <div key={step.label} className="flex items-center gap-3">
            <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
              {state === 'done' && <CheckIcon />}
              {state === 'active' && <Spinner small />}
              {state === 'pending' && <div className="w-4 h-4 rounded-full border-2 border-gray-300" />}
            </div>
            <span className={`text-sm ${state === 'active' ? 'text-gray-900 font-medium' : state === 'done' ? 'text-gray-500' : 'text-gray-300'}`}>
              {step.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── STATE B — Mapping ─────────────────────────────────────────────────────────

function MappingState({
  job,
  jobId,
}: {
  job: JobWithHeaders
  jobId: string
}) {
  const [mapping, setMapping] = useState<ColumnMapping>(() => job.column_mapping!)
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  const sourceHeaders = job.sourceHeaders ?? []

  const mappedSourceColumns = new Set(
    FIELD_ORDER
      .map((f) => mapping[f].source_column)
      .filter((s): s is string => s !== null)
  )

  const unmappedTargets = (Object.entries(mapping) as [keyof ColumnMapping, ColumnMappingField][])
    .filter(([, value]) => value.source_column === null)
    .map(([field]) => field)
  const ignoredHeaders = sourceHeaders.filter((h) => !mappedSourceColumns.has(h))

  function updateField(field: keyof ColumnMapping, sourceColumn: string | null) {
    setMapping((prev) => ({
      ...prev,
      [field]: { ...prev[field], source_column: sourceColumn },
    }))
  }

  async function handleConfirm() {
    if (confirming) return
    setConfirming(true)
    setConfirmError(null)
    try {
      const res = await fetch('/api/enrich/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, columnMapping: mapping }),
      })
      if (!res.ok) {
        const err = await res.json()
        setConfirmError(err.error || 'Confirmation failed')
        setConfirming(false)
        return
      }
      // SUCCESS — do NOT setConfirming(false)
      // polling handles the transition automatically
    } catch {
      setConfirmError('Network error. Please try again.')
      setConfirming(false)
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-2">Review Column Mapping</h2>
      <p className="text-sm text-gray-500 mb-6">
        Gemini detected the following mapping. You can adjust any field using the dropdown.
      </p>

      <div className="overflow-x-auto rounded-lg border border-gray-200 mb-6">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Target Field</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Detected Source Column</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Confidence</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Override</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {FIELD_ORDER.map((field) => {
              const f = mapping[field]
              return (
                <tr key={field}>
                  <td className="px-4 py-3 font-medium text-gray-700">{TARGET_FIELD_LABELS[field]}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {f.source_column ?? <span className="text-gray-400 italic">— not found —</span>}
                  </td>
                  <td className="px-4 py-3"><ConfidenceBadge confidence={f.confidence} /></td>
                  <td className="px-4 py-3">
                    <select
                      value={f.source_column ?? ''}
                      onChange={(e) => updateField(field, e.target.value || null)}
                      className="rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">— leave blank —</option>
                      {sourceHeaders.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {unmappedTargets.length > 0 && (
        <div className="mb-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200">
          <p className="text-sm font-medium text-yellow-800 mb-1">Will be blank in output:</p>
          <ul className="text-sm text-yellow-700 list-disc list-inside">
            {unmappedTargets.map((f) => <li key={f}>{TARGET_FIELD_LABELS[f]}</li>)}
          </ul>
        </div>
      )}

      {ignoredHeaders.length > 0 && (
        <div className="mb-6 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-sm font-medium text-gray-600 mb-1">Ignored source columns:</p>
          <p className="text-sm text-gray-500">{ignoredHeaders.join(', ')}</p>
        </div>
      )}

      {confirmError && <p className="text-sm text-red-600 mb-4">{confirmError}</p>}

      <button
        onClick={handleConfirm}
        disabled={confirming}
        className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {confirming ? 'Confirming…' : 'Confirm and generate sheets'}
      </button>
    </div>
  )
}

// ── STATE C — Ready ───────────────────────────────────────────────────────────

const FORMATTED_INPUT_HEADERS = [
  'name', 'email', 'phone', 'team_name', 'brokerage', 'website', 'location', 'hs_ticket_url',
]

function ReadyState({
  job,
  rows,
  onRunEnrichment,
  starting,
  runError,
}: {
  job: JobWithHeaders
  rows: EnrichRow[]
  onRunEnrichment: () => Promise<void>
  starting: boolean
  runError: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const displayRows = expanded ? rows : rows.slice(0, 5)

  return (
    <div>
      <div className="mb-6">
        <p className="text-green-700 font-medium">{rows.length} rows formatted successfully</p>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => downloadAsCSV(
            rows.map(r => r.formatted_input).filter(Boolean) as Record<string, unknown>[],
            `formatted-input-${job.id}.csv`
          )}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Download formatted CSV
        </button>

        <button
          onClick={onRunEnrichment}
          disabled={starting}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {starting ? 'Starting…' : 'Run Enrichment'}
        </button>
      </div>

      {runError && <p className="text-sm text-red-600 mb-4">{runError}</p>}

      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-sm">Formatted Input ({rows.length} rows)</h3>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 mb-4">
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-50">
            <tr>
              {FORMATTED_INPUT_HEADERS.map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {displayRows.map((row) => (
              <tr key={row.id}>
                {FORMATTED_INPUT_HEADERS.map((h) => (
                  <td key={h} className="px-3 py-2 text-gray-600 max-w-xs truncate" title={row.formatted_input?.[h as keyof typeof row.formatted_input] ?? ''}>
                    {row.formatted_input?.[h as keyof typeof row.formatted_input] || <span className="text-gray-300">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > 5 && (
        <button
          onClick={() => setExpanded((p) => !p)}
          className="text-sm text-blue-600 hover:underline mb-6"
        >
          {expanded ? 'Show fewer rows' : `View all ${rows.length} rows`}
        </button>
      )}

      <div className="text-xs text-gray-400 space-y-1 border-t border-gray-100 pt-4">
        <p>Created: {new Date(job.created_at).toLocaleString()}</p>
        <p>File: {job.sheet_url}</p>
        {job.parsed_at && <p>Confirmed at: {new Date(job.parsed_at).toLocaleString()}</p>}
      </div>
    </div>
  )
}

// ── STATE D — Pipeline running ────────────────────────────────────────────────

const PIPELINE_STAGES: {
  label: string
  runningStatus: EnrichJob['status']
  completedAtKey: keyof EnrichJob
  foundCountKey: keyof EnrichJob
}[] = [
  {
    label: 'Stage 1 — Zillow platform search',
    runningStatus: 'stage1_running',
    completedAtKey: 'stage1_completed_at',
    foundCountKey: 'stage1_found_count',
  },
  {
    label: 'Stage 2 — Database lookup',
    runningStatus: 'stage2_running',
    completedAtKey: 'stage2_completed_at',
    foundCountKey: 'stage2_found_count',
  },
  {
    label: 'Stage 3 — Scrape enrichment',
    runningStatus: 'stage3_running',
    completedAtKey: 'stage3_completed_at',
    foundCountKey: 'stage3_found_count',
  },
]

function PipelineRunningState({ job }: { job: EnrichJob }) {
  const totalRows = job.raw_row_count ?? 0
  const foundSoFar =
    (job.stage1_found_count ?? 0) +
    (job.stage2_found_count ?? 0) +
    (job.stage3_found_count ?? 0)

  return (
    <div>
      <h2 className="text-lg font-semibold mb-2">Running enrichment pipeline</h2>
      <p className="text-sm text-gray-500 mb-6">{totalRows} rows being processed</p>

      <div className="space-y-4 mb-6">
        {PIPELINE_STAGES.map((stage, i) => {
          const isComplete = job[stage.completedAtKey] !== null
          const isActive = job.status === stage.runningStatus
          const foundCount = job[stage.foundCountKey] as number | null

          return (
            <div key={i} className="flex items-center gap-3">
              <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                {isComplete && <CheckIcon />}
                {isActive && <Spinner small />}
                {!isComplete && !isActive && <div className="w-4 h-4 rounded-full border-2 border-gray-300" />}
              </div>
              <span className={`text-sm ${isActive ? 'text-gray-900 font-medium' : isComplete ? 'text-gray-500' : 'text-gray-300'}`}>
                {stage.label}
                {isComplete && (
                  <span className="ml-2 text-green-600 font-medium">
                    — {foundCount ?? 0} found
                  </span>
                )}
              </span>
            </div>
          )
        })}
      </div>

      {foundSoFar > 0 && (
        <p className="text-sm text-gray-500">{foundSoFar} found so far</p>
      )}
    </div>
  )
}

// ── STATE E — Complete ────────────────────────────────────────────────────────

function CompleteState({ job, rows }: { job: EnrichJob; rows: EnrichRow[] }) {
  const [expanded, setExpanded] = useState(false)

  const totalRows = job.raw_row_count ?? 0
  const s1Found = job.stage1_found_count ?? 0
  const s2Found = job.stage2_found_count ?? 0
  const s3Found = job.stage3_found_count ?? 0
  const notFound = totalRows - s1Found - s2Found - s3Found

  const displayRows = expanded ? rows : rows.slice(0, 10)

  function downloadEnrichedRows() {
    const foundRows = rows.filter(r => r.enrichment_status === 'found' && r.enriched_data)
    if (foundRows.length === 0) return
    const allKeys = new Set<string>()
    foundRows.forEach(r => Object.keys(r.enriched_data!).forEach(k => allKeys.add(k)))
    const headers = Array.from(allKeys)
    const csvData = foundRows.map(r => {
      const row: Record<string, unknown> = {}
      headers.forEach(k => { row[k] = r.enriched_data![k] ?? '' })
      return row
    })
    downloadAsCSV(csvData, `enriched-found-${job.id}.csv`)
  }

  function downloadNotFoundRows() {
    const nfRows = rows.filter(r => r.enrichment_status === 'not_found' && r.formatted_input)
    if (nfRows.length === 0) return
    downloadAsCSV(
      nfRows.map(r => r.formatted_input as unknown as Record<string, unknown>),
      `enriched-notfound-${job.id}.csv`
    )
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Enrichment complete</h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total rows', value: totalRows },
          { label: 'Stage 1 found', value: s1Found },
          { label: 'Stage 2 found', value: s2Found },
          { label: 'Stage 3 found', value: s3Found },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-gray-200 p-3 text-center">
            <p className="text-2xl font-semibold text-gray-900">{value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {notFound > 0 && (
        <p className="text-sm text-gray-500 mb-4">
          {notFound} row{notFound !== 1 ? 's' : ''} not found after all stages
        </p>
      )}

      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={downloadEnrichedRows}
          className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
        >
          Download enriched rows
        </button>
        <button
          onClick={downloadNotFoundRows}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Download not found rows
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 mb-3">
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-500">Name</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500">Email</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500">Status</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500">Stage reached</th>
              <th className="px-3 py-2 text-left font-medium text-gray-500">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {displayRows.map((row) => (
              <tr key={row.id}>
                <td className="px-3 py-2 text-gray-700 max-w-[160px] truncate">
                  {row.formatted_input?.name || <span className="text-gray-300">—</span>}
                </td>
                <td className="px-3 py-2 text-gray-600 max-w-[200px] truncate">
                  {row.formatted_input?.email || <span className="text-gray-300">—</span>}
                </td>
                <td className="px-3 py-2">
                  <EnrichmentStatusBadge status={row.enrichment_status} />
                </td>
                <td className="px-3 py-2 text-gray-500">
                  {row.stage_reached ?? '—'}
                </td>
                <td className="px-3 py-2 text-gray-500">
                  {(row.enriched_data?.source as string | undefined) ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > 10 && (
        <button
          onClick={() => setExpanded(p => !p)}
          className="text-sm text-blue-600 hover:underline"
        >
          {expanded ? 'Show fewer rows' : `View all ${rows.length} rows`}
        </button>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const RUNNING_STATUSES: EnrichJob['status'][] = ['stage1_running', 'stage2_running', 'stage3_running']

export default function JobDetailPage() {
  const params = useParams()
  const jobId = params.jobId as string

  const [job, setJob] = useState<JobWithHeaders | null>(null)
  const [rows, setRows] = useState<EnrichRow[]>([])
  const [notFound, setNotFound] = useState(false)
  const [starting, setStarting] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  useEffect(() => {
    if (!jobId) return
    let isMounted = true
    let timeoutId: NodeJS.Timeout

    const TERMINAL = ['complete', 'failed']

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/enrich/status/${jobId}`,
          { cache: 'no-store' }
        )
        if (!res.ok) {
          if (res.status === 404 && isMounted) setNotFound(true)
          return
        }
        const data = await res.json()
        if (isMounted) setJob(data)
        if (isMounted && !TERMINAL.includes(data.status)) {
          timeoutId = setTimeout(poll, 2000)
        }
      } catch {
        if (isMounted) timeoutId = setTimeout(poll, 3000)
      }
    }

    poll()
    return () => {
      isMounted = false
      clearTimeout(timeoutId)
    }
  }, [jobId])

  const jobStatus = job?.status
  useEffect(() => {
    if (jobStatus !== 'ready' && jobStatus !== 'complete') return
    fetch(`/api/enrich/jobs/${jobId}/rows`, { cache: 'no-store' })
      .then(r => r.json())
      .then(json => { if (json.data) setRows(json.data) })
      .catch(() => {})
  }, [jobStatus, jobId])

  async function runEnrichment() {
    setStarting(true)
    setRunError(null)
    try {
      const res = await fetch(`/api/enrich/run/${jobId}`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        setRunError(json.error ?? 'Failed to start enrichment')
        setStarting(false)
      }
      // success: keep disabled — polling handles the transition
    } catch {
      setRunError('Network error — could not start enrichment')
      setStarting(false)
    }
  }

  if (notFound) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-10">
        <p className="text-gray-500">Job not found.</p>
        <a href="/" className="text-blue-600 hover:underline text-sm mt-2 block">← Back to dashboard</a>
      </main>
    )
  }

  if (!job) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-10">
        <div className="flex items-center justify-center min-h-64">
          <Spinner />
        </div>
      </main>
    )
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-10">
      <a href="/" className="text-sm text-gray-500 hover:text-gray-700 mb-6 block">← Back to dashboard</a>

      {job.status === 'failed' && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <h2 className="font-semibold text-red-800 mb-1">Job Failed</h2>
          <p className="text-sm text-red-700 mb-3">{job.error_log ?? 'An unknown error occurred.'}</p>
          <a href="/" className="inline-block rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">
            Start over
          </a>
        </div>
      )}

      {job.status === 'complete' && (
        <CompleteState job={job} rows={rows} />
      )}

      {RUNNING_STATUSES.includes(job.status) && (
        <PipelineRunningState job={job} />
      )}

      {job.status === 'ready' && (
        <ReadyState
          job={job}
          rows={rows}
          onRunEnrichment={runEnrichment}
          starting={starting}
          runError={runError}
        />
      )}

      {job.status === 'awaiting_confirmation' && job.column_mapping && (
        <MappingState job={job} jobId={jobId} />
      )}

      {job.status === 'generating' && (
        <ProcessingState status={job.status} />
      )}

      {job.status !== 'failed' &&
       job.status !== 'complete' &&
       !RUNNING_STATUSES.includes(job.status) &&
       job.status !== 'ready' &&
       job.status !== 'awaiting_confirmation' &&
       job.status !== 'generating' && (
        <ProcessingState status={job.status} />
      )}
    </main>
  )
}
