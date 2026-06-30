export interface User {
  id: string
  username: string
  createdAt: string
}

export interface AuthResponse {
  token: string
  user: User
}

export interface AuthState {
  user: User | null
  token: string
  isAuthenticated: boolean
}

export interface LoginParams {
  username: string
  password: string
}

export interface RegisterParams {
  username: string
  password: string
}
