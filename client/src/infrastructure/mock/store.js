import { USE_MOCK } from '../config.js'
import { SEED_USERS } from './seed/users.js'
import { SEED_PROJECTS } from './seed/projects.js'
import { SEED_ORDER_REQUESTS } from './seed/order-requests.js'

const LS_KEY = 'yz_mock_state_v7'

export const mockUsers = [...SEED_USERS]
export const mockProjects = [...SEED_PROJECTS]
export const mockDemos = []
export const mockOrderRequests = [...SEED_ORDER_REQUESTS]
export const mockHandovers = []

export function saveState() {
  if (!USE_MOCK || typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        users: mockUsers,
        projects: mockProjects,
        demos: mockDemos,
        orderRequests: mockOrderRequests,
        handovers: mockHandovers,
      }),
    )
  } catch {
    /* ignore quota / private-mode errors */
  }
}

export function hydrateState() {
  if (!USE_MOCK || typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (Array.isArray(saved.users)) {
      const seedUsers = [...SEED_USERS]
      const byEmail = new Set(saved.users.map((u) => u.email?.toLowerCase()))
      const merged = [...saved.users]
      for (const u of seedUsers) {
        if (!byEmail.has(u.email?.toLowerCase())) merged.push(u)
      }
      mockUsers.length = 0
      mockUsers.push(...merged)
    }
    if (Array.isArray(saved.projects)) {
      mockProjects.length = 0
      mockProjects.push(...saved.projects)
    }
    if (Array.isArray(saved.demos)) {
      mockDemos.length = 0
      mockDemos.push(...saved.demos)
    }
    if (Array.isArray(saved.orderRequests)) {
      mockOrderRequests.length = 0
      mockOrderRequests.push(...saved.orderRequests)
    }
    if (Array.isArray(saved.handovers)) {
      mockHandovers.length = 0
      mockHandovers.push(...saved.handovers)
    }
  } catch {
    /* corrupt state — fall back to seed data */
  }
}

export function resetMockState() {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(LS_KEY)
    } catch {
      /* ignore */
    }
  }
  mockUsers.length = 0
  mockUsers.push(...SEED_USERS)
  mockProjects.length = 0
  mockProjects.push(...SEED_PROJECTS)
  mockDemos.length = 0
  mockOrderRequests.length = 0
  mockOrderRequests.push(...SEED_ORDER_REQUESTS)
  mockHandovers.length = 0
}

export function delay(ms = 350) {
  return new Promise((r) => setTimeout(r, ms))
}

hydrateState()
