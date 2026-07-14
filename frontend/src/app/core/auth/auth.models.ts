// Auth contracts — mirror the backend's /api/auth responses (see backend auth.controller).

export interface User {
  id: string;
  email: string;
}

export interface Credentials {
  email: string;
  password: string;
}

// register/login → { user, accessToken } (+ httpOnly refresh cookie set by the server).
export interface AuthResponse {
  user: User;
  accessToken: string;
}

// refresh → { accessToken } (+ rotated refresh cookie).
export interface RefreshResponse {
  accessToken: string;
}

// GET /me → { user }.
export interface MeResponse {
  user: User;
}
