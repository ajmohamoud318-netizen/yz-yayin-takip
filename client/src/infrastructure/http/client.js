import axios from 'axios'

const client = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

let authToken = null

export function setAuthToken(token) {
  authToken = token
}

export function getAuthToken() {
  return authToken
}

export function getCurrentUserId() {
  return authToken?.replace('mock-', '') ?? null
}

client.interceptors.request.use((config) => {
  if (authToken) config.headers.Authorization = `Bearer ${authToken}`
  return config
})

export { client as httpClient }
