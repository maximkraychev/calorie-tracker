import type { Request, Response } from 'express';

import {
  createEntriesSchema,
  dateQuerySchema,
  entryIdSchema,
  updateEntrySchema,
} from './diary.schema.js';
import * as diaryService from './diary.service.js';

export async function getDiary(req: Request, res: Response) {
  const { date } = dateQuerySchema.parse(req.query);
  const day = await diaryService.getDiary(req.userId!, date);
  res.json(day);
}

export async function createEntries(req: Request, res: Response) {
  const body = createEntriesSchema.parse(req.body);
  const entries = await diaryService.addEntries(req.userId!, body);
  res.status(201).json(entries);
}

export async function updateEntry(req: Request, res: Response) {
  const { id } = entryIdSchema.parse(req.params);
  const patch = updateEntrySchema.parse(req.body);
  const entry = await diaryService.updateEntry(req.userId!, id, patch);
  res.json(entry);
}

export async function deleteEntry(req: Request, res: Response) {
  const { id } = entryIdSchema.parse(req.params);
  await diaryService.deleteEntry(req.userId!, id);
  res.status(204).end();
}
