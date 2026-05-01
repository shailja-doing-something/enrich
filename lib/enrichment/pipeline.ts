import { getRowsByJob, updateRow } from '../supabase/rows'
import { updateJob } from '../supabase/jobs'
import { runStage1 } from './stage1'
import { runStage2 } from './stage2'
import { runStage3 } from './stage3'

export async function runEnrichmentPipeline(jobId: string): Promise<void> {
  try {
    const allRows = await getRowsByJob(jobId)
    const pendingRows = allRows.filter(r => r.enrichment_status === 'pending')

    if (pendingRows.length === 0) {
      await updateJob(jobId, { status: 'complete' })
      return
    }

    // Stage 1
    await updateJob(jobId, { status: 'stage1_running' })
    const stage1Results = await runStage1(pendingRows)
    let stage1Found = 0

    for (const result of stage1Results) {
      if (result.found) {
        stage1Found++
        await updateRow(result.row.id, {
          enrichment_status: 'found',
          stage_reached: 1,
          enriched_data: result.enrichedData,
        })
      } else {
        await updateRow(result.row.id, {
          enrichment_status: 'not_found',
          stage_reached: 1,
        })
      }
    }

    await updateJob(jobId, {
      stage1_completed_at: new Date().toISOString(),
      stage1_found_count: stage1Found,
    })

    const stage2Rows = stage1Results.filter(r => !r.found).map(r => r.row)
    if (stage2Rows.length === 0) {
      await updateJob(jobId, { status: 'complete' })
      return
    }

    // Stage 2
    await updateJob(jobId, { status: 'stage2_running' })
    const stage2Results = await runStage2(stage2Rows)
    let stage2Found = 0

    for (const result of stage2Results) {
      if (result.found) {
        stage2Found++
        await updateRow(result.row.id, {
          enrichment_status: 'found',
          stage_reached: 2,
          enriched_data: result.enrichedData,
        })
      } else {
        await updateRow(result.row.id, {
          enrichment_status: 'not_found',
          stage_reached: 2,
        })
      }
    }

    await updateJob(jobId, {
      stage2_completed_at: new Date().toISOString(),
      stage2_found_count: stage2Found,
    })

    const stage3Rows = stage2Results.filter(r => !r.found).map(r => r.row)
    if (stage3Rows.length === 0) {
      await updateJob(jobId, { status: 'complete' })
      return
    }

    // Stage 3
    await updateJob(jobId, { status: 'stage3_running' })
    const stage3Results = await runStage3(stage3Rows)
    let stage3Found = 0

    for (const result of stage3Results) {
      if (result.found) {
        stage3Found++
        await updateRow(result.row.id, {
          enrichment_status: 'found',
          stage_reached: 3,
          enriched_data: result.enrichedData,
        })
      } else {
        await updateRow(result.row.id, {
          enrichment_status: 'not_found',
          stage_reached: 3,
        })
      }
    }

    await updateJob(jobId, {
      stage3_completed_at: new Date().toISOString(),
      stage3_found_count: stage3Found,
    })

    await updateJob(jobId, { status: 'complete' })
  } catch (e) {
    await updateJob(jobId, {
      status: 'failed',
      error_log: e instanceof Error ? e.message : 'Unknown pipeline error',
    })
  }
}
