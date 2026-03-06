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
}

type UseAsyncResourceOptions<T> = {
  enabled: boolean
  requestKey: string | null
  initialData: T
  load: (signal: AbortSignal) => Promise<T>
  getErrorMessage: (error: unknown) => string
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
}: UseAsyncResourceOptions<T>) => {
  const [reloadToken, setReloadToken] = useState(0)
  const [state, setState] = useState<AsyncResourceState<T>>({
    requestKey: null,
    status: 'idle',
    data: initialData,
    error: null,
  })

  const activeRequestKey =
    enabled && requestKey
      ? `${requestKey}:${reloadToken}`
      : null

  const commitSuccess = useEffectEvent(
    (resolvedRequestKey: string, data: T) => {
      startTransition(() => {
        setState({
          requestKey: resolvedRequestKey,
          status: 'success',
          data,
          error: null,
        })
      })
    },
  )

  const commitError = useEffectEvent(
    (resolvedRequestKey: string, error: unknown) => {
      startTransition(() => {
        setState({
          requestKey: resolvedRequestKey,
          status: 'error',
          data: initialData,
          error: getErrorMessage(error),
        })
      })
    },
  )

  useEffect(() => {
    if (!activeRequestKey) {
      return
    }

    const controller = new AbortController()

    void load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          commitSuccess(activeRequestKey, data)
        }
      })
      .catch((error) => {
        if (
          !controller.signal.aborted &&
          !isAbortError(error)
        ) {
          commitError(activeRequestKey, error)
        }
      })

    return () => {
      controller.abort()
    }
  }, [activeRequestKey, load])

  const hasResolvedCurrentRequest =
    !!activeRequestKey && state.requestKey === activeRequestKey

  const isLoading =
    enabled && !!activeRequestKey && !hasResolvedCurrentRequest

  const data = hasResolvedCurrentRequest ? state.data : initialData
  const error =
    hasResolvedCurrentRequest && state.status === 'error'
      ? state.error
      : null

  const reload = useCallback(() => {
    setReloadToken((value) => value + 1)
  }, [])

  return {
    data,
    error,
    isLoading,
    hasResolvedCurrentRequest,
    reload,
  }
}
