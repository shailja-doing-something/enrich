'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { EnrichJob } from '@/lib/supabase/types'

function StatusBadge({ status }: { status: EnrichJob['status'] }) {
  const processing = ['pending', 'parsing', 'mapping', 'generating']
  if (processing.includes(status)) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">Processing</span>
  }
  if (status === 'awaiting_confirmation') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">Needs review</span>
  }
  if (status === 'ready') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Ready</span>
  }
  if (status === 'stage1_running') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">Stage 1</span>
  }
  if (status === 'stage2_running') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">Stage 2</span>
  }
  if (status === 'stage3_running') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">Stage 3</span>
  }
  if (status === 'complete') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-700 text-white">Complete</span>
  }
  if (status === 'failed') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">Failed</span>
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

  const addDeleting = (id: string) => {
    deletingIdsRef.current.add(id)
    setDeletingIds(new Set(deletingIdsRef.current))
  }

  const removeDeleting = (id: string) => {
    deletingIdsRef.current.delete(id)
    setDeletingIds(new Set(deletingIdsRef.current))
  }

  const hsTicketValid = hsTicketUrl.startsWith('https://app.hubspot.com/')

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
      const jobs = json.data ?? json ?? []
      setJobs((jobs as EnrichJob[]).filter((j) => j.status !== 'failed'))
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
    </main>
  )
}
