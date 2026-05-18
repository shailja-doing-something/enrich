'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { EnrichJob } from '@/lib/supabase/types'

type CompanyBatch = {
  batch_id: string
  source_file: string
  created_at: string
  total_rows: number
  status: string
}

function BatchStatusBadge({ status }: { status: string }) {
  if (status === 'complete') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-700 text-white">Complete</span>
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

  const addDeleting = (id: string) => {
    deletingIdsRef.current.add(id)
    setDeletingIds(new Set(deletingIdsRef.current))
  }

  const removeDeleting = (id: string) => {
    deletingIdsRef.current.delete(id)
    setDeletingIds(new Set(deletingIdsRef.current))
  }

  const hsTicketValid = hsTicketUrl.startsWith('https://app.hubspot.com/')

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
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        },
      })
      if (!res.ok) return
      const json = await res.json()
      const jobs = (json.data ?? json ?? []) as EnrichJob[]
      jobs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setJobs(jobs)
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
      if (isMounted) {
        timeoutId = setTimeout(poll, 3000)
      }
    }

    poll()

    return () => {
      isMounted = false
      clearTimeout(timeoutId)
    }
  }, [])

  useEffect(() => {
    let isMounted = true
    let timeoutId: NodeJS.Timeout

    const poll = async () => {
      await fetchBatches()
      if (isMounted) timeoutId = setTimeout(poll, 5000)
    }

    poll()

    return () => {
      isMounted = false
      clearTimeout(timeoutId)
    }
  }, [])

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
    } catch {
      setCeError('Network error — could not reach the server')
    } finally {
      setCeSubmitting(false)
    }
  }

  const handleDelete = async (jobId: string) => {
    const confirmed = window.confirm(
      'Delete this job and all its rows? This cannot be undone.'
    )
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

        {error && (
          <p className="mt-2 text-sm text-red-600">{error}</p>
        )}
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
                  <td className="px-4 py-3 text-gray-600">
                    {job.raw_row_count ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={job.status} />
                  </td>
                  <td className="px-4 py-3 flex items-center gap-3">
                    <a
                      href={`/jobs/${job.id}`}
                      className="text-blue-600 hover:underline text-sm"
                    >
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

      <h2 className="text-xl font-semibold mb-6">Company Enrichment</h2>

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
              {ceBatches.map((batch) => (
                <tr key={batch.batch_id}>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {new Date(batch.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-gray-600 max-w-xs truncate" title={batch.source_file}>
                    {batch.source_file}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{batch.total_rows}</td>
                  <td className="px-4 py-3">
                    <BatchStatusBadge status={batch.status} />
                  </td>
                  <td className="px-4 py-3">
                    {batch.status === 'complete' && (
                      <a
                        href={`/api/company-enrichment/export/${batch.batch_id}`}
                        className="text-blue-600 hover:underline text-sm"
                      >
                        Download CSV
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
