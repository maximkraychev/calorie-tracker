import type { Request, Response } from 'express';

export function getHealth(_req: Request, res: Response) {
  res.json({ status: 'up', message: 'Calorie Tracker API is running' });
}
