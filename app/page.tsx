'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Papa from 'papaparse'
import type { EnrichJob } from '@/lib/supabase/types'

type CompanyBatch = {
  batch_id: string
  source_file: string
  created_at: string
  total_rows: number
  status: string
  current_stage: string | null
  contacts_count: number
}

type BatchDetail = {
  batch_id: string
  source_file: string
  stage: string | null
  status: string
  created_at: string
  total_rows: number
  total_teams: number
  website_processed: number
  website_found: number
  zillow_processed: number
  zillow_found: number
  qa_processed: number
  verified_count: number
  contacts_processed: number
  contacts_done: number
  contact_skipped: number
  contacts_failed: number
  web_valid_count: number
  zillow_valid_count: number
  agents_count: number
}

type StageStatus = 'pending' | 'running' | 'complete' | 'failed'

function deriveWebsiteStatus(d: BatchDetail): StageStatus {
  if (d.total_teams > 0 && d.website_processed === d.total_teams) return 'complete'
  if (d.website_processed > 0 || d.stage === 'finding_websites') return 'running'
  return 'pending'
}

function deriveZillowStatus(d: BatchDetail): StageStatus {
  if (d.total_teams > 0 && d.zillow_processed === d.total_teams) return 'complete'
  const wsDone = d.total_teams > 0 && d.website_processed === d.total_teams
  if (wsDone && (d.zillow_processed > 0 || d.stage === 'zillow_lookup')) return 'running'
  return 'pending'
}

function deriveQaStatus(d: BatchDetail): StageStatus {
  if (d.total_teams > 0 && d.qa_processed === d.total_teams) return 'complete'
  const zlDone = d.total_teams > 0 && d.zillow_processed === d.total_teams
  if (zlDone && (d.qa_processed > 0 || d.stage === 'verifying_urls')) return 'running'
  return 'pending'
}

function deriveContactsStatus(d: BatchDetail): StageStatus {
  if (d.stage === 'contacts_done') return 'complete'
  if (d.stage === 'contacts_failed') return 'failed'
  if (d.stage === 'contacts_running' || d.stage === 'enriching_contacts') return 'running'
  return 'pending'
}

function stageDotClass(s: StageStatus): string {
  if (s === 'complete') return 'bg-green-500'
  if (s === 'running') return 'bg-blue-400'
  if (s === 'failed') return 'bg-red-500'
  return 'bg-gray-300'
}

function stageBorderClass(s: StageStatus): string {
  if (s === 'complete') return 'border-green-200 bg-green-50'
  if (s === 'running') return 'border-blue-200 bg-blue-50'
  if (s === 'failed') return 'border-red-200 bg-red-50'
  return 'border-gray-200 bg-white'
}

function stageTextClass(s: StageStatus): string {
  if (s === 'complete') return 'text-green-700'
  if (s === 'running') return 'text-blue-700'
  if (s === 'failed') return 'text-red-600'
  return 'text-gray-400'
}

function BatchStatusBadge({ status }: { status: string }) {
  if (status === 'complete') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-700 text-white">Complete</span>
  }
  if (status === 'enriching_contacts') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">Finding contacts</span>
  }
  if (status === 'finding_websites') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">Finding websites</span>
  }
  if (status === 'verifying_urls') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">Verifying URLs</span>
  }
  if (status === 'failed') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">Failed</span>
  }
  return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">Pending</span>
}

function StatusBadge({ status }: { status: EnrichJob['status'] }) {
  if (status === 'failed') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">Failed</span>
  }
  if (['stage1_running', 'stage2_running', 'both_running', 'branch1_running', 'branch2_running'].includes(status)) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">Running</span>
  }
  if (status === 'merging') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">Merging</span>
  }
  if (status === 'complete') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-700 text-white">Complete</span>
  }
  if (status === 'ready') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Ready</span>
  }
  if (status === 'generating') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">Generating</span>
  }
  if (status === 'awaiting_confirmation') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">Needs review</span>
  }
  if (['pending', 'parsing', 'mapping'].includes(status)) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">Processing</span>
  }
  return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">{status}</span>
}

function truncate(str: string, max = 60): string {
  return str.length > max ? str.slice(0, max) + '…' : str
}

export default function DashboardPage() {
  const router = useRouter()
  const [jobs, setJobs] = useState<EnrichJob[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [hsTicketUrl, setHsTicketUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const deletingIdsRef = useRef<Set<string>>(new Set())

  const [ceFile, setCeFile] = useState<File | null>(null)
  const [ceSubmitting, setCeSubmitting] = useState(false)
  const [ceError, setCeError] = useState<string | null>(null)
  const [ceBatches, setCeBatches] = useState<CompanyBatch[]>([])
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null)
  const [batchDetails, setBatchDetails] = useState<Record<string, BatchDetail>>({})
  const [startingContactIds, setStartingContactIds] = useState<Set<string>>(new Set())
  const [teamsEnriched, setTeamsEnriched] = useState<number | null>(null)
  const [deletingBatchIds, setDeletingBatchIds] = useState<Set<string>>(new Set())
  const deletingBatchIdsRef = useRef<Set<string>>(new Set())

  // Zillow URL Finder (standalone)
  type ZfResultRow = {
    mad_id: string; team_name: string; brokerage: string; location: string
    zillow_url: string | null; match_score: number; matched_name: string | null
    rejection_reason?: string
  }
  const [zfFile, setZfFile] = useState<File | null>(null)
  const [zfRunning, setZfRunning] = useState(false)
  const [zfError, setZfError] = useState<string | null>(null)
  const [zfProgress, setZfProgress] = useState(0)
  const [zfTotal, setZfTotal] = useState(0)
  const [zfResults, setZfResults] = useState<ZfResultRow[] | null>(null)

  const addDeleting = (id: string) => {
    deletingIdsRef.current.add(id)
    setDeletingIds(new Set(deletingIdsRef.current))
  }

  const removeDeleting = (id: string) => {
    deletingIdsRef.current.delete(id)
    setDeletingIds(new Set(deletingIdsRef.current))
  }

  const hsTicketValid = hsTicketUrl.startsWith('https://app.hubspot.com/')

  const fetchBatchDetail = (batchId: string) => {
    fetch(`/api/company-enrichment/jobs/${batchId}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
    })
      .then(res => res.ok ? res.json() : null)
      .then((json: unknown) => {
        if (json && typeof json === 'object' && 'data' in json) {
          const detail = (json as { data: BatchDetail }).data
          if (detail) setBatchDetails(prev => ({ ...prev, [batchId]: detail }))
        }
      })
      .catch(() => { /* silent */ })
  }

  const toggleExpand = (batchId: string) => {
    if (expandedBatchId === batchId) {
      setExpandedBatchId(null)
      return
    }
    setExpandedBatchId(batchId)
    fetchBatchDetail(batchId)
  }

  const handleStartContacts = async (batchId: string) => {
    setStartingContactIds(prev => { const n = new Set(prev); n.add(batchId); return n })
    try {
      const res = await fetch(`/api/company-enrichment/run-contacts/${batchId}`, { method: 'POST' })
      if (!res.ok) {
        const json: unknown = await res.json().catch(() => ({}))
        const msg = (typeof json === 'object' && json !== null && 'error' in json)
          ? String((json as Record<string, unknown>).error)
          : 'Failed to start contact enrichment'
        alert(msg)
        return
      }
      fetchBatchDetail(batchId)
    } catch {
      alert('Network error. Please try again.')
    } finally {
      setStartingContactIds(prev => { const n = new Set(prev); n.delete(batchId); return n })
    }
  }

  const fetchTeamsEnriched = async () => {
    try {
      const res = await fetch(`/api/company-enrichment/teams-enriched?t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
      })
      if (!res.ok) return
      const json = await res.json()
      setTeamsEnriched(json.data?.count ?? 0)
    } catch {
      // silent
    }
  }

  const fetchBatches = async () => {
    try {
      const res = await fetch(`/api/company-enrichment/jobs?t=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
      })
      if (!res.ok) return
      const json = await res.json()
      setCeBatches((json.data ?? []) as CompanyBatch[])
    } catch {
      // silent — polling will retry
    }
  }

  const fetchJobs = async () => {
    try {
      const res = await fetch(`/api/enrich/jobs?t=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
      })
      if (!res.ok) return
      const json = await res.json()
      const fetched = (json.data ?? json ?? []) as EnrichJob[]
      fetched.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setJobs(fetched)
    } catch {
      // silent — polling will retry
    }
  }

  useEffect(() => {
    let isMounted = true
    let timeoutId: NodeJS.Timeout

    const poll = async () => {
      if (deletingIdsRef.current.size > 0) {
        if (isMounted) timeoutId = setTimeout(poll, 1000)
        return
      }
      await fetchJobs()
      if (isMounted) timeoutId = setTimeout(poll, 3000)
    }

    poll()
    return () => { isMounted = false; clearTimeout(timeoutId) }
  }, [])

  useEffect(() => {
    let isMounted = true
    let timeoutId: NodeJS.Timeout

    const poll = async () => {
      await fetchBatches()
      if (isMounted) timeoutId = setTimeout(poll, 5000)
    }

    poll()
    return () => { isMounted = false; clearTimeout(timeoutId) }
  }, [])

  useEffect(() => {
    let isMounted = true
    let timeoutId: NodeJS.Timeout

    const poll = async () => {
      await fetchTeamsEnriched()
      if (isMounted) timeoutId = setTimeout(poll, 30_000)
    }

    poll()
    return () => { isMounted = false; clearTimeout(timeoutId) }
  }, [])

  // Detail polling — only fires while a batch is expanded and not terminal
  useEffect(() => {
    if (!expandedBatchId) return

    let isMounted = true
    let timeoutId: NodeJS.Timeout

    const poll = async () => {
      try {
        const res = await fetch(`/api/company-enrichment/jobs/${expandedBatchId}?t=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
        })
        if (res.ok) {
          const json = await res.json()
          const detail = (json as { data?: BatchDetail }).data
          if (detail) {
            setBatchDetails(prev => ({ ...prev, [expandedBatchId]: detail }))
            if (detail.stage === 'contacts_done' || detail.stage === 'contacts_failed') return
          }
        }
      } catch {
        // silent
      }
      if (isMounted) timeoutId = setTimeout(poll, 5000)
    }

    // First poll after 5s — toggleExpand already fetches on open
    timeoutId = setTimeout(poll, 5000)
    return () => { isMounted = false; clearTimeout(timeoutId) }
  }, [expandedBatchId])

  async function handleCeSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!ceFile) {
      setCeError('Please select a CSV file')
      return
    }
    setCeError(null)
    setCeSubmitting(true)
    try {
      const formData = new FormData()
      formData.append('file', ceFile)
      const res = await fetch('/api/company-enrichment/start', {
        method: 'POST',
        body: formData,
      })
      let json: { data?: { batch_id: string; row_count: number }; error?: string }
      try {
        json = await res.json()
      } catch {
        setCeError(`Server error (status ${res.status}) — check Railway logs`)
        return
      }
      if (!res.ok) {
        setCeError(json.error ?? 'Something went wrong')
        return
      }
      setCeFile(null)
      await fetchBatches()
      await fetchTeamsEnriched()
    } catch {
      setCeError('Network error — could not reach the server')
    } finally {
      setCeSubmitting(false)
    }
  }

  const handleBatchDelete = async (batchId: string, isComplete: boolean) => {
    const confirmed = window.confirm('Delete this batch and all its teams? This cannot be undone.')
    if (!confirmed) return

    setCeBatches(prev => prev.filter(b => b.batch_id !== batchId))
    if (expandedBatchId === batchId) setExpandedBatchId(null)
    setBatchDetails(prev => { const n = { ...prev }; delete n[batchId]; return n })
    deletingBatchIdsRef.current.add(batchId)
    setDeletingBatchIds(new Set(deletingBatchIdsRef.current))

    try {
      const res = await fetch(`/api/company-enrichment/jobs/${batchId}`, { method: 'DELETE' })
      if (!res.ok) {
        const json: unknown = await res.json().catch(() => ({}))
        const msg = (typeof json === 'object' && json !== null && 'error' in json)
          ? String((json as Record<string, unknown>).error)
          : 'Delete failed. Please try again.'
        alert(msg)
        await fetchBatches()
      } else if (isComplete) {
        await fetchTeamsEnriched()
      }
    } catch {
      alert('Network error. Please try again.')
      await fetchBatches()
    } finally {
      deletingBatchIdsRef.current.delete(batchId)
      setDeletingBatchIds(new Set(deletingBatchIdsRef.current))
    }
  }

  const handleDelete = async (jobId: string) => {
    const confirmed = window.confirm('Delete this job and all its rows? This cannot be undone.')
    if (!confirmed) return

    setJobs(prev => prev.filter(j => j.id !== jobId))
    addDeleting(jobId)

    try {
      const res = await fetch(`/api/enrich/delete/${jobId}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Delete failed. Please try again.')
        await fetchJobs()
      }
    } catch {
      alert('Network error. Please try again.')
      await fetchJobs()
    } finally {
      removeDeleting(jobId)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) {
      setError('Please select a CSV file')
      return
    }
    if (!hsTicketValid) {
      setError('HubSpot ticket URL must start with https://app.hubspot.com/')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('hs_ticket_url', hsTicketUrl)
      const res = await fetch('/api/enrich/start', {
        method: 'POST',
        body: formData,
      })
      let json: { data?: { jobId: string }; error?: string }
      try {
        json = await res.json()
      } catch {
        setError(`Server error (status ${res.status}) — check Railway logs`)
        return
      }
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong')
        return
      }
      router.push(`/jobs/${json.data!.jobId}`)
    } catch {
      setError('Network error — could not reach the server')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleZfSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!zfFile) {
      setZfError('Please select a CSV file')
      return
    }
    setZfError(null)
    setZfResults(null)
    setZfProgress(0)

    const text = await zfFile.text()
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true })

    const REQUIRED = ['MAD_ID', 'Team Name', 'Brokerage', 'Location']
    const headers = Object.keys(parsed.data[0] ?? {})
    const missing = REQUIRED.filter(c => !headers.includes(c))
    if (missing.length > 0) {
      setZfError(`CSV is missing required columns: ${missing.join(', ')}`)
      return
    }

    const allRows = parsed.data.map(r => ({
      mad_id: r['MAD_ID'] ?? '',
      team_name: r['Team Name'] ?? '',
      brokerage: r['Brokerage'] ?? '',
      location: r['Location'] ?? '',
    }))

    setZfTotal(allRows.length)
    setZfRunning(true)

    const BATCH = 5
    const accumulated: ZfResultRow[] = []

    try {
      for (let i = 0; i < allRows.length; i += BATCH) {
        const chunk = allRows.slice(i, i + BATCH)
        const res = await fetch('/api/zillow-finder/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: chunk }),
        })
        const json: unknown = await res.json().catch(() => ({}))
        if (!res.ok) {
          const msg = (typeof json === 'object' && json !== null && 'error' in json)
            ? String((json as Record<string, unknown>).error)
            : `Server error (${res.status})`
          setZfError(msg)
          return
        }
        const results = (
          typeof json === 'object' && json !== null &&
          'data' in json &&
          typeof (json as Record<string, unknown>).data === 'object' &&
          (json as Record<string, unknown>).data !== null &&
          'results' in ((json as Record<string, unknown>).data as object)
        )
          ? ((json as { data: { results: ZfResultRow[] } }).data.results)
          : []
        accumulated.push(...results)
        setZfProgress(Math.min(i + BATCH, allRows.length))
      }
      setZfResults(accumulated)
    } catch {
      setZfError('Network error — could not reach the server')
    } finally {
      setZfRunning(false)
    }
  }

  function downloadZfCsv(results: ZfResultRow[]) {
    const header = 'MAD_ID,Team Name,Brokerage,Location,Zillow URL,Match Score,Matched Name'
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`
    const lines = results.map(r =>
      [
        escape(r.mad_id),
        escape(r.team_name),
        escape(r.brokerage),
        escape(r.location),
        escape(r.zillow_url ?? ''),
        String(r.match_score),
        escape(r.matched_name ?? ''),
      ].join(',')
    )
    const csv = [header, ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `zillow-finder-results-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold mb-8">Enrich</h1>

      <form onSubmit={handleSubmit} className="mb-10">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Upload contacts CSV
        </label>
        <div className="flex items-center gap-3">
          <label className="cursor-pointer rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 whitespace-nowrap">
            {file ? file.name : 'Choose file…'}
            <input
              type="file"
              accept=".csv"
              className="sr-only"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setError(null)
              }}
            />
          </label>
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            HubSpot Ticket URL
          </label>
          <input
            type="text"
            value={hsTicketUrl}
            onChange={(e) => { setHsTicketUrl(e.target.value); setError(null) }}
            placeholder="https://app.hubspot.com/contacts/..."
            className="w-full max-w-lg rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-400">The ticket this list came from. Applied to every row.</p>
          {hsTicketUrl.length > 0 && !hsTicketValid && (
            <p className="mt-1 text-xs text-red-600">Must start with https://app.hubspot.com/</p>
          )}
        </div>

        <div className="mt-4">
          <button
            type="submit"
            disabled={submitting || !file || !hsTicketValid}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Uploading…' : 'Upload and detect columns'}
          </button>
        </div>

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </form>

      {jobs.length === 0 ? (
        <p className="text-sm text-gray-500">No jobs yet. Upload a CSV file above to get started.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Created</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">File</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Rows</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {new Date(job.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 max-w-xs text-gray-600 truncate" title={job.sheet_url}>
                    {job.sheet_url.startsWith('https://')
                      ? truncate(new URL(job.sheet_url).hostname, 40)
                      : job.sheet_url}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{job.raw_row_count ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={job.status} />
                  </td>
                  <td className="px-4 py-3 flex items-center gap-3">
                    <a href={`/jobs/${job.id}`} className="text-blue-600 hover:underline text-sm">
                      View
                    </a>
                    <button
                      onClick={() => handleDelete(job.id)}
                      disabled={deletingIds.has(job.id)}
                      className="text-red-500 hover:underline text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {deletingIds.has(job.id) ? 'Deleting...' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <hr className="my-10 border-gray-200" />

      <h2 className="text-xl font-semibold mb-4">Enrichment Q2</h2>

      {teamsEnriched !== null && (() => {
        const TARGET = 20_000
        const count = teamsEnriched
        const pct = Math.min(count / TARGET, 1)
        const pctDisplay = (pct * 100).toFixed(1)
        const reached = count >= TARGET
        return (
          <div className="mb-6">
            <div className="flex items-center justify-between text-sm mb-1">
              {reached ? (
                <span className="font-medium text-green-700">20,000+ target reached 🎉</span>
              ) : (
                <span className="text-gray-600">{count.toLocaleString()} / 20,000+ teams enriched</span>
              )}
              {!reached && <span className="text-gray-400">{pctDisplay}%</span>}
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-2.5 rounded-full transition-all ${reached ? 'bg-green-600' : 'bg-blue-500'}`}
                style={{ width: reached ? '100%' : `${pct * 100}%` }}
              />
            </div>
          </div>
        )
      })()}

      <form onSubmit={handleCeSubmit} className="mb-10">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Upload teams CSV
        </label>
        <p className="mb-2 text-xs text-gray-400">Required columns: MAD_ID, Team Name, Brokerage, Location</p>
        <div className="flex items-center gap-3">
          <label className="cursor-pointer rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 whitespace-nowrap">
            {ceFile ? ceFile.name : 'Choose file…'}
            <input
              type="file"
              accept=".csv"
              className="sr-only"
              onChange={(e) => {
                setCeFile(e.target.files?.[0] ?? null)
                setCeError(null)
              }}
            />
          </label>
          <button
            type="submit"
            disabled={ceSubmitting || !ceFile}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {ceSubmitting ? 'Uploading…' : 'Upload and enrich'}
          </button>
        </div>
        {ceError && <p className="mt-2 text-sm text-red-600">{ceError}</p>}
      </form>

      {ceBatches.length === 0 ? (
        <p className="text-sm text-gray-500">No company enrichment batches yet.</p>
      ) : (
        <div className="space-y-2">
          {ceBatches.map((batch) => {
            const isExpanded = expandedBatchId === batch.batch_id
            const detail = batchDetails[batch.batch_id]

            return (
              <div key={batch.batch_id} className="rounded-lg border border-gray-200 overflow-hidden">

                {/* Header row — click anywhere to expand/collapse */}
                <div
                  className="flex items-center gap-3 px-4 py-3 bg-white text-sm cursor-pointer hover:bg-gray-50 select-none flex-wrap"
                  onClick={() => toggleExpand(batch.batch_id)}
                >
                  <span className="text-gray-400 text-xs w-3 flex-shrink-0">
                    {isExpanded ? '▼' : '▶'}
                  </span>
                  <span className="text-gray-400 whitespace-nowrap">
                    {new Date(batch.created_at).toLocaleString()}
                  </span>
                  <span className="text-gray-600 max-w-xs truncate" title={batch.source_file}>
                    {batch.source_file}
                  </span>
                  <span className="text-gray-500">{batch.total_rows} rows</span>
                  <BatchStatusBadge status={batch.status} />

                  <div
                    className="ml-auto flex items-center gap-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <a
                      href={`/api/company-enrichment/export/${batch.batch_id}`}
                      className="text-blue-600 hover:underline text-sm"
                    >
                      Download teams CSV
                    </a>
                    <button
                      onClick={() => handleBatchDelete(batch.batch_id, batch.status === 'complete')}
                      disabled={deletingBatchIds.has(batch.batch_id)}
                      className="text-red-500 hover:underline text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {deletingBatchIds.has(batch.batch_id) ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>

                {/* Expanded detail panel */}
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
                    {!detail ? (
                      <p className="text-sm text-gray-400">Loading…</p>
                    ) : (() => {
                      const total = detail.total_teams
                      const wsStatus = deriveWebsiteStatus(detail)
                      const zlStatus = deriveZillowStatus(detail)
                      const qaStatus = deriveQaStatus(detail)
                      const ctStatus = deriveContactsStatus(detail)
                      const showGate =
                        total > 0 &&
                        detail.qa_processed === total &&
                        ctStatus === 'pending'

                      const stages = [
                        { num: 1, name: 'Website Discovery', status: wsStatus, label: `${detail.website_found}/${total} found` },
                        { num: 2, name: 'Zillow Lookup', status: zlStatus, label: `${detail.zillow_found}/${total} matched` },
                        { num: 3, name: 'QA Verification', status: qaStatus, label: `${detail.verified_count}/${total} verified` },
                        {
                          num: 4, name: 'Contact Enrichment', status: ctStatus,
                          label: ctStatus === 'complete'
                            ? `${detail.agents_count} contacts`
                            : `${detail.contacts_processed}/${total} processed`,
                        },
                      ]

                      return (
                        <>
                          {/* 4-stage pipeline tracker */}
                          <div className="flex flex-wrap items-start gap-1 mb-4">
                            {stages.map((s, i) => (
                              <div key={s.num} className="flex items-start">
                                <div className={`rounded-lg border px-3 py-2 text-xs min-w-[132px] ${stageBorderClass(s.status)}`}>
                                  <div className="flex items-center gap-1.5 mb-0.5">
                                    <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${stageDotClass(s.status)}`} />
                                    <span className="font-medium text-gray-700">{s.name}</span>
                                  </div>
                                  <div className="text-gray-500 pl-3.5">{s.label}</div>
                                  <div className={`pl-3.5 mt-0.5 font-medium ${stageTextClass(s.status)}`}>
                                    {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                                  </div>
                                </div>
                                {i < 3 && (
                                  <span className="text-gray-300 text-xs self-center mx-0.5 mt-1">→</span>
                                )}
                              </div>
                            ))}
                          </div>

                          {/* Approval gate: shown when QA is done but contacts not started */}
                          {showGate && (
                            <div className="rounded-lg border border-blue-200 bg-white px-4 py-3">
                              <p className="text-sm font-semibold text-gray-800 mb-1">Company enrichment complete.</p>
                              <p className="text-sm text-gray-600">{detail.verified_count} teams verified (web or Zillow)</p>
                              <p className="text-sm text-gray-600">
                                {total - detail.verified_count} teams failed verification — will be skipped
                              </p>
                              <p className="text-sm text-gray-600 mb-3">
                                Ready to start contact enrichment for {detail.verified_count} teams.
                              </p>
                              <button
                                onClick={() => handleStartContacts(batch.batch_id)}
                                disabled={startingContactIds.has(batch.batch_id)}
                                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {startingContactIds.has(batch.batch_id) ? 'Starting…' : 'Start contact enrichment →'}
                              </button>
                            </div>
                          )}

                          {/* Contacts complete */}
                          {ctStatus === 'complete' && (
                            <div className="mt-3 flex items-center gap-4">
                              <span className="text-sm text-gray-600">{detail.agents_count} contacts found</span>
                              <a
                                href={`/api/company-enrichment/export-contacts/${batch.batch_id}`}
                                className="text-sm text-blue-600 hover:underline"
                              >
                                Download contacts CSV
                              </a>
                            </div>
                          )}
                        </>
                      )
                    })()}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <hr className="my-10 border-gray-200" />

      <h2 className="text-xl font-semibold mb-1">Zillow URL Finder (standalone)</h2>
      <p className="text-sm text-gray-500 mb-1">
        Upload a CSV of teams. Get back the same CSV with matched Zillow profile URLs. Nothing is saved.
      </p>
      <p className="mb-4 text-xs text-gray-400">Required columns: MAD_ID, Team Name, Brokerage, Location</p>

      <form onSubmit={handleZfSubmit} className="mb-6">
        <div className="flex items-center gap-3">
          <label className="cursor-pointer rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 whitespace-nowrap">
            {zfFile ? zfFile.name : 'Choose file…'}
            <input
              type="file"
              accept=".csv"
              className="sr-only"
              onChange={(e) => {
                setZfFile(e.target.files?.[0] ?? null)
                setZfError(null)
                setZfResults(null)
                setZfProgress(0)
                setZfTotal(0)
              }}
            />
          </label>
          <button
            type="submit"
            disabled={zfRunning || !zfFile}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {zfRunning ? 'Running…' : 'Find Zillow URLs'}
          </button>
        </div>
        {zfError && <p className="mt-2 text-sm text-red-600">{zfError}</p>}
      </form>

      {zfRunning && zfTotal > 0 && (
        <div className="mb-4">
          <p className="text-sm text-gray-600 mb-1">
            Processing row {Math.min(zfProgress + 5, zfTotal)} of {zfTotal}…
          </p>
          <div className="w-full max-w-sm bg-gray-100 rounded-full h-2 overflow-hidden">
            <div
              className="h-2 bg-blue-500 rounded-full transition-all"
              style={{ width: `${zfTotal > 0 ? (zfProgress / zfTotal) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {zfResults !== null && !zfRunning && (() => {
        const matched = zfResults.filter(r => r.zillow_url).length
        return (
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              Matched: <span className="font-medium">{matched} / {zfResults.length}</span> teams
            </span>
            <button
              onClick={() => downloadZfCsv(zfResults)}
              className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
            >
              Download results CSV
            </button>
          </div>
        )
      })()}
    </main>
  )
}
