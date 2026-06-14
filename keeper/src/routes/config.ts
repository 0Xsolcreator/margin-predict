/// GET /config/leverage-range — valid leverage bounds for new positions.

import type { FastifyInstance } from 'fastify';
import { getLeverageRange } from '../math/leverage.js';

export function registerConfigRoutes(app: FastifyInstance): void {
  app.get('/config/leverage-range', async () => getLeverageRange());
}
