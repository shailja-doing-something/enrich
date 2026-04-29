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
  if (status === 'ready' || status === 'complete') {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Ready</span>
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
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function fetchJobs() {
    try {
      const res = await fetch('/api/enrich/jobs')
      const json = await res.json()
      if (json.data) setJobs((json.data as EnrichJob[]).filter((j) => j.status !== 'failed'))
    } catch {
      // silent — polling will retry
    }
  }

  useEffect(() => {
    fetchJobs()
    intervalRef.current = setInterval(fetchJobs, 10000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) {
      setError('Please select a CSV file')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
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
          <button
            type="submit"
            disabled={submitting || !file}
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
                  <td className="px-4 py-3">
                    <a
                      href={`/jobs/${job.id}`}
                      className="text-blue-600 hover:underline text-sm"
                    >
                      View
                    </a>
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
