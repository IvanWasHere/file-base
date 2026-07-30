import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addFavorite,
  listFavorites,
  removeFavorite,
  type Favorite,
} from '@/services/db/repositories/favorites'
import { listRecents, type Recent } from '@/services/db/repositories/recents'

export const dbKeys = {
  favorites: ['db', 'favorites'] as const,
  recents: ['db', 'recents'] as const,
}

export function useFavorites() {
  const queryClient = useQueryClient()

  const query = useQuery<Favorite[]>({
    queryKey: dbKeys.favorites,
    queryFn: listFavorites,
    // A missing database should leave the sidebar empty, not error the app.
    retry: false,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: dbKeys.favorites })

  const add = useMutation({
    mutationFn: (path: string) => addFavorite(path),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: (path: string) => removeFavorite(path),
    onSuccess: invalidate,
  })

  const favorites = query.data ?? []

  return {
    favorites,
    isPinned: (path: string) => favorites.some((favorite) => favorite.path === path),
    pin: (path: string) => add.mutate(path),
    unpin: (path: string) => remove.mutate(path),
  }
}

export function useRecents(limit = 8) {
  const query = useQuery<Recent[]>({
    queryKey: [...dbKeys.recents, limit],
    queryFn: () => listRecents(limit),
    retry: false,
  })

  return { recents: query.data ?? [] }
}
