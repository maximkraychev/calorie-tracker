declare global {
  namespace Express {
    interface Request {
      /** Set by require-auth middleware from the access token's sub claim. */
      userId?: string;
    }
  }
}

export {};
