'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import type { EnrichJob, EnrichRow, ColumnMapping, ColumnMappingField } from '@/lib/supabase/types'

type JobWithHeaders = EnrichJob & { sourceHeaders: string[] }

const TARGET_FIELD_LABELS: Partial<Record<keyof ColumnMapping, string>> = {
  list_name: 'Full Name',
  list_email: 'Email',
  list_phone: 'Phone',
  list_team_name: 'Team Name',
  list_brokerage: 'Brokerage',
  list_website: 'Website',
  list_location: 'Location',
}

const FIELD_ORDER: (keyof ColumnMapping)[] = [
  'list_name', 'list_email', 'list_phone', 'list_team_name',
  'list_brokerage', 'list_website', 'list_location',
]

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

function Spinner() {
  return (
    <div className="flex items-center justify-center min-h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  )
}

type StepState = 'pending' | 'active' | 'done'

const STEPS: { label: string; activeOn: EnrichJob['status'][] }[] = [
  { label: 'Uploading CSV',         activeOn: ['pending', 'parsing'] },
  { label: 'Detecting columns',     activeOn: ['mapping'] },
  { label: 'Generating input sheets', activeOn: ['generating'] },
]

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
              {state === 'done' && (
                <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
              {state === 'active' && (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
              )}
              {state === 'pending' && (
                <div className="w-4 h-4 rounded-full border-2 border-gray-300" />
              )}
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

function MappingState({
  job,
  onConfirm,
}: {
  job: JobWithHeaders
  onConfirm: (mapping: ColumnMapping) => Promise<void>
}) {
  const [mapping, setMapping] = useState<ColumnMapping>(() => job.column_mapping!)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sourceHeaders = job.sourceHeaders ?? []

  const mappedSourceColumns = new Set(
    FIELD_ORDER
      .map((f) => mapping[f].source_column)
      .filter((s): s is string => s !== null)
  )

  const unmappedTargets = (Object.entries(mapping) as [keyof ColumnMapping, ColumnMappingField][])
    .filter(([field, value]) => field !== 'HS_Ticket' && value.source_column === null)
    .map(([field]) => field)
  const ignoredHeaders = sourceHeaders.filter((h) => !mappedSourceColumns.has(h))

  function updateField(field: keyof ColumnMapping, sourceColumn: string | null) {
    setMapping((prev) => ({
      ...prev,
      [field]: { ...prev[field], source_column: sourceColumn },
    }))
  }

  async function handleConfirm() {
    setConfirming(true)
    setError(null)
    try {
      await onConfirm(mapping)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
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
                  <td className="px-4 py-3">
                    <ConfidenceBadge confidence={f.confidence} />
                  </td>
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
            {unmappedTargets.map((f) => (
              <li key={f}>{TARGET_FIELD_LABELS[f]}</li>
            ))}
          </ul>
        </div>
      )}

      {ignoredHeaders.length > 0 && (
        <div className="mb-6 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-sm font-medium text-gray-600 mb-1">Ignored source columns:</p>
          <p className="text-sm text-gray-500">{ignoredHeaders.join(', ')}</p>
        </div>
      )}

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

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

const TEAM_SIZE_HEADERS = ['list_name', 'list_email', 'list_phone', 'list_team_name', 'list_brokerage', 'list_website', 'list_location', 'HS_Ticket']
const ZILLOW_HEADERS = ['list_name', 'list_company', 'list_location', 'brokerage_name', 'list_mobile', 'list_email', 'HS_ticket_link']

function ReadyState({ job, rows }: { job: JobWithHeaders; rows: EnrichRow[] }) {
  const [expanded, setExpanded] = useState(false)
  const displayRows = expanded ? rows : rows.slice(0, 5)

  return (
    <div>
      <div className="mb-6">
        <p className="text-green-700 font-medium">{rows.length} rows generated successfully</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div>
          <h3 className="font-semibold text-sm mb-2">Team Size Input ({rows.length} rows)</h3>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-xs">
              <thead className="bg-gray-50">
                <tr>
                  {TEAM_SIZE_HEADERS.map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {displayRows.map((row) => (
                  <tr key={row.id}>
                    {TEAM_SIZE_HEADERS.map((h) => (
                      <td key={h} className="px-3 py-2 text-gray-600 max-w-xs truncate" title={row.team_size_input?.[h as keyof typeof row.team_size_input] ?? ''}>
                        {row.team_size_input?.[h as keyof typeof row.team_size_input] || <span className="text-gray-300">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-sm mb-2">Zillow Input ({rows.length} rows)</h3>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-xs">
              <thead className="bg-gray-50">
                <tr>
                  {ZILLOW_HEADERS.map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {displayRows.map((row) => (
                  <tr key={row.id}>
                    {ZILLOW_HEADERS.map((h) => (
                      <td key={h} className="px-3 py-2 text-gray-600 max-w-xs truncate" title={row.zillow_input?.[h as keyof typeof row.zillow_input] ?? ''}>
                        {row.zillow_input?.[h as keyof typeof row.zillow_input] || <span className="text-gray-300">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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
        <p>Sheet: <a href={job.sheet_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{job.sheet_url}</a></p>
        {job.parsed_at && <p>Confirmed at: {new Date(job.parsed_at).toLocaleString()}</p>}
      </div>
    </div>
  )
}

export default function JobDetailPage() {
  const params = useParams()
  const jobId = params.jobId as string

  const [job, setJob] = useState<JobWithHeaders | null>(null)
  const [rows, setRows] = useState<EnrichRow[]>([])
  const [notFound, setNotFound] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchJob = useCallback(async () => {
    try {
      const res = await fetch(`/api/enrich/status/${jobId}`)
      if (res.status === 404) { setNotFound(true); return }
      const json = await res.json()
      if (json.data) setJob(json.data)
    } catch {
      // retry next interval
    }
  }, [jobId])

  const fetchRows = useCallback(async () => {
    try {
      const res = await fetch(`/api/enrich/jobs/${jobId}/rows`)
      const json = await res.json()
      if (json.data) setRows(json.data)
    } catch {
      // silent
    }
  }, [jobId])

  useEffect(() => {
    fetchJob()
  }, [fetchJob])

  useEffect(() => {
    if (!job) return

    const isProcessing = ['pending', 'parsing', 'mapping', 'generating'].includes(job.status)

    if (intervalRef.current) clearInterval(intervalRef.current)

    if (isProcessing) {
      intervalRef.current = setInterval(fetchJob, 2000)
    }

    if (job.status === 'ready' || job.status === 'complete') {
      fetchRows()
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [job?.status, fetchJob, fetchRows])

  async function handleConfirm(mapping: ColumnMapping) {
    const res = await fetch('/api/enrich/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, columnMapping: mapping }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Failed to confirm mapping')
    await fetchJob()
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
        <Spinner />
      </main>
    )
  }

  const processing = ['pending', 'parsing', 'mapping', 'generating']

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

      {processing.includes(job.status) && (
        <ProcessingState status={job.status} />
      )}

      {job.status === 'awaiting_confirmation' && job.column_mapping && (
        <MappingState job={job} onConfirm={handleConfirm} />
      )}

      {(job.status === 'ready' || job.status === 'complete') && (
        <ReadyState job={job} rows={rows} />
      )}
    </main>
  )
}
