import {
  startTransition,
  useCallback,
  useEffect,
  useEffectEvent,
  useState,
} from 'react'

type AsyncResourceStatus = 'idle' | 'success' | 'error'

type AsyncResourceState<T> = {
  requestKey: string | null
  status: AsyncResourceStatus
  data: T
  error: string | null
  hasData: boolean
  updatedAt: number | null
}

type UseAsyncResourceOptions<T> = {
  enabled: boolean
  requestKey: string | null
  initialData: T
  load: (signal: AbortSignal) => Promise<T>
  getErrorMessage: (error: unknown) => string
  keepPreviousData?: boolean
}

type AsyncResourceCacheEntry<T> = {
  data: T
  updatedAt: number
}

const asyncResourceCache = new Map<
  string,
  AsyncResourceCacheEntry<unknown>
>()

const getCachedResource = <T,>(requestKey: string | null) => {
  if (!requestKey) {
    return null
  }

  const cachedEntry = asyncResourceCache.get(requestKey)
  return cachedEntry
    ? (cachedEntry as AsyncResourceCacheEntry<T>)
    : null
}

const isAbortError = (error: unknown) => {
  if (error instanceof DOMException) {
    return error.name === 'AbortError'
  }

  if (error instanceof Error) {
    return error.name === 'AbortError' || error.message === 'canceled'
  }

  return false
}

export const useAsyncResource = <T,>({
  enabled,
  requestKey,
  initialData,
  load,
  getErrorMessage,
  keepPreviousData = false,
}: UseAsyncResourceOptions<T>) => {
  const logicalRequestKey =
    enabled && requestKey ? requestKey : null
  const [reloadToken, setReloadToken] = useState(0)
  const initialCachedResource =
    keepPreviousData && logicalRequestKey
      ? getCachedResource<T>(logicalRequestKey)
      : null
  const [state, setState] = useState<AsyncResourceState<T>>({
    requestKey: null,
    status: initialCachedResource ? 'success' : 'idle',
    data: initialCachedResource?.data ?? initialData,
    error: null,
    hasData: initialCachedResource !== null,
    updatedAt: initialCachedResource?.updatedAt ?? null,
  })

  const activeRequestKey =
    logicalRequestKey
      ? `${logicalRequestKey}:${reloadToken}`
      : null
  const cachedResource =
    keepPreviousData && logicalRequestKey
      ? getCachedResource<T>(logicalRequestKey)
      : null

  const commitSuccess = useEffectEvent(
    (
      resolvedRequestKey: string,
      resolvedLogicalRequestKey: string,
      data: T,
    ) => {
      const updatedAt = Date.now()
      asyncResourceCache.set(resolvedLogicalRequestKey, {
        data,
        updatedAt,
      })

      startTransition(() => {
        setState({
          requestKey: resolvedRequestKey,
          status: 'success',
          data,
          error: null,
          hasData: true,
          updatedAt,
        })
      })
    },
  )

  const commitError = useEffectEvent(
    (
      resolvedRequestKey: string,
      resolvedLogicalRequestKey: string,
      error: unknown,
    ) => {
      startTransition(() => {
        setState((current) => {
          const cachedEntry =
            keepPreviousData
              ? getCachedResource<T>(resolvedLogicalRequestKey)
              : null
          const shouldPreserveData =
            keepPreviousData &&
            (cachedEntry !== null || current.hasData)

          return {
            requestKey: resolvedRequestKey,
            status: 'error',
            data: cachedEntry?.data ??
              (shouldPreserveData ? current.data : initialData),
            error: getErrorMessage(error),
            hasData: shouldPreserveData,
            updatedAt:
              cachedEntry?.updatedAt ??
              (shouldPreserveData ? current.updatedAt : null),
          }
        })
      })
    },
  )

  useEffect(() => {
    if (!activeRequestKey || !logicalRequestKey) {
      return
    }

    const controller = new AbortController()

    void load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          commitSuccess(
            activeRequestKey,
            logicalRequestKey,
            data,
          )
        }
      })
      .catch((error) => {
        if (
          !controller.signal.aborted &&
          !isAbortError(error)
        ) {
          commitError(
            activeRequestKey,
            logicalRequestKey,
            error,
          )
        }
      })

    return () => {
      controller.abort()
    }
  }, [activeRequestKey, load, logicalRequestKey])

  const hasResolvedCurrentRequest =
    !!activeRequestKey && state.requestKey === activeRequestKey

  const displayedCachedResource =
    !hasResolvedCurrentRequest ? cachedResource : null
  const hasData =
    !!logicalRequestKey &&
    (hasResolvedCurrentRequest
      ? state.hasData
      : displayedCachedResource !== null ||
        (keepPreviousData && state.hasData))
  const isLoading =
    enabled && !!activeRequestKey && !hasResolvedCurrentRequest
  const isRefreshing = isLoading && hasData
  const isInitialLoading = isLoading && !hasData

  const data = hasResolvedCurrentRequest
    ? state.data
    : displayedCachedResource?.data ??
      (keepPreviousData && logicalRequestKey && state.hasData
        ? state.data
        : initialData)
  const error =
    hasResolvedCurrentRequest && state.status === 'error'
      ? state.error
      : null
  const updatedAt = hasResolvedCurrentRequest
    ? state.updatedAt
    : displayedCachedResource?.updatedAt ??
      (keepPreviousData && logicalRequestKey && state.hasData
        ? state.updatedAt
        : null)

  const reload = useCallback(() => {
    setReloadToken((value) => value + 1)
  }, [])

  return {
    data,
    error,
    hasData,
    isLoading,
    isRefreshing,
    isInitialLoading,
    hasResolvedCurrentRequest,
    updatedAt,
    reload,
  }
}
