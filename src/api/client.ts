import axios from 'axios'

export const apiClient = axios.create({
  baseURL: 'https://iis.bsuir.by/api',
  timeout: 10000,
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('[API error]', error)
    }

    return Promise.reject(error)
  },
)

