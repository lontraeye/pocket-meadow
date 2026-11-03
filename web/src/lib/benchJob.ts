// Conta do lote da bancada (5.23), sem a arte: o aviso de "pronto" e os testes
// usam sem passar pelo Vite.

import type { BenchView } from './api'

/** Quantas do lote já ficaram prontas em `now` (igual ao servidor). */
export function benchDone(job: Pick<NonNullable<BenchView['job']>, 'quantity' | 'unitMs' | 'startedAt'>, now: number): number {
  return Math.max(0, Math.min(job.quantity, Math.floor((now - job.startedAt) / job.unitMs)))
}
