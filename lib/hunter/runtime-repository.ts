import { getDb } from "../db";
import { createHunterRepository } from "./repository";
import { ensureHunterSchema } from "./schema";

let repository: ReturnType<typeof createHunterRepository> | null = null;

export function getHunterRepository() {
  if (!repository) {
    const db = getDb();
    ensureHunterSchema(db);
    repository = createHunterRepository(db);
  }
  return repository;
}
