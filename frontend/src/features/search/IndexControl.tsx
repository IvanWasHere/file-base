import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Zap } from 'lucide-react'
import { useState } from 'react'
import {
  dropIndex,
  indexAvailable,
  indexRoot,
  readIndexRecord,
  type IndexRecord,
} from '@/services/search/searchIndex'
import { toast } from '@/stores/toastStore'
import { basename } from '@/utils/path'

/**
 * Builds and drops the instant-search index for one folder (PLAN.md M8).
 *
 * Indexing is opt-in per folder, never automatic. Walking a home directory to
 * build an index is minutes of disk work the user did not ask for, and doing it
 * behind their back is the behaviour people resent in desktop search. The offer
 * appears where the cost is about to be paid — beside the control that starts a
 * recursive search.
 *
 * The index record is server state like any other read of the outside world, so
 * it lives in React Query rather than in an effect writing to component state.
 */

interface IndexState {
  available: boolean
  record: IndexRecord | null
}

const indexKey = (root: string) => ['searchIndex', root] as const

function ago(timestamp: number, now: number = Date.now()): string {
  const minutes = Math.round((now - timestamp) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function IndexControl({ root }: { root: string }) {
  const queryClient = useQueryClient()
  // Progress arrives from a callback during the mutation, which is an event,
  // not a render — safe to hold locally.
  const [progress, setProgress] = useState(0)

  const { data } = useQuery<IndexState>({
    queryKey: indexKey(root),
    queryFn: async () => {
      if (!(await indexAvailable())) return { available: false, record: null }
      return { available: true, record: await readIndexRecord(root) }
    },
    staleTime: 30_000,
  })

  const build = useMutation({
    mutationFn: () => indexRoot(root, { onProgress: ({ indexed }) => setProgress(indexed) }),
    onSuccess: (record) => {
      void queryClient.invalidateQueries({ queryKey: indexKey(root) })
      toast.info(
        `Indexed ${basename(root) || root}`,
        `${record.entries.toLocaleString()} items are now searchable instantly.`,
      )
    },
    onError: (error: unknown) => {
      toast.error(
        'Could not build the search index',
        error instanceof Error ? error.message : String(error),
      )
    },
    onSettled: () => setProgress(0),
  })

  const remove = useMutation({
    mutationFn: () => dropIndex(root),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: indexKey(root) }),
    onError: () => toast.error('Could not remove the index'),
  })

  // Nothing to offer while the probe is in flight, or when this build has no
  // FTS5 — search still works, it just walks.
  if (!data?.available) return null

  if (build.isPending) {
    return (
      <span className="text-muted flex shrink-0 items-center gap-1 text-[11px]">
        <Loader2 size={11} className="animate-spin" />
        Indexing… {progress.toLocaleString()}
      </span>
    )
  }

  const record = data.record
  if (record?.status === 'ready') {
    return (
      <span className="text-muted flex shrink-0 items-center gap-1.5 text-[11px]">
        <Zap size={11} className="text-accent" />
        <span title={`${record.entries.toLocaleString()} entries`}>
          Indexed {ago(record.indexedAt)}
        </span>
        <button
          type="button"
          onClick={() => remove.mutate()}
          className="hover:text-primary underline decoration-dotted transition-colors"
        >
          remove
        </button>
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => build.mutate()}
      className="text-muted hover:text-primary flex shrink-0 items-center gap-1 text-[11px] transition-colors"
      title="Build an index so searching this folder is instant"
    >
      <Zap size={11} />
      Index folder
    </button>
  )
}
