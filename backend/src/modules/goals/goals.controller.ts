import type { Request, Response } from 'express';

import { goalQuerySchema, saveGoalSchema } from './goals.schema.js';
import * as goalsService from './goals.service.js';

// Both routes are date-relative, and the client is the authority on what "today" is: the
// diary keys days by *local* ISO date, so an entry logged just after midnight in Sofia
// must not be filed under the server's (UTC) yesterday. The client always sends its own
// date; this is only the fallback for one that doesn't.
function serverToday(): string {
  return new Date().toISOString().slice(0, 10);
}

// Wrapped in an object rather than returned bare because the goal may legitimately be
// null (no goal set yet), and a bare `null` body is an awkward thing for a client to
// distinguish from an empty response.
export async function getGoal(req: Request, res: Response) {
  const { date } = goalQuerySchema.parse(req.query);
  const goal = await goalsService.getGoalForDate(req.userId!, date ?? serverToday());
  res.json({ goal });
}

export async function saveGoal(req: Request, res: Response) {
  const body = saveGoalSchema.parse(req.body);
  const goal = await goalsService.saveGoal(req.userId!, body, serverToday());
  res.json({ goal });
}
