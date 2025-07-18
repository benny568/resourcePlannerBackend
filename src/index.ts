import express from 'express';
import cors from 'cors';
import teamMembersRoutes from './routes/teamMembers';
import workItemsRoutes from './routes/workItems';
import sprintsRoutes from './routes/sprints';
import holidaysRoutes from './routes/holidays';
import sprintConfigRoutes from './routes/sprintConfig';
import jiraIntegrationRoutes from './routes/jiraIntegration';
import { PrismaClient } from '@prisma/client';

const app = express();
const port = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Prisma
const prisma = new PrismaClient();

// Routes
app.use('/api/team-members', teamMembersRoutes);
app.use('/api/work-items', workItemsRoutes);
app.use('/api/sprints', sprintsRoutes);
app.use('/api/holidays', holidaysRoutes);
app.use('/api/sprint-config', sprintConfigRoutes);
app.use('/api/jira', jiraIntegrationRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Error handling
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://0.0.0.0:${port}`);
  console.log(`📊 API endpoints available:`);
  console.log(`  - GET  /api/health`);
  console.log(`  - GET  /api/team-members`);
  console.log(`  - POST /api/team-members`);
  console.log(`  - GET  /api/work-items`);
  console.log(`  - POST /api/work-items`);
  console.log(`  - GET  /api/sprints`);
  console.log(`  - POST /api/sprints`);
  console.log(`  - GET  /api/holidays`);
  console.log(`  - POST /api/holidays`);
  console.log(`  - GET  /api/sprint-config`);
  console.log(`  - POST /api/sprint-config`);
  console.log(`  - POST /api/jira/team-members`);
  console.log(`  - POST /api/jira/epics`);
  console.log(`  - POST /api/jira/import`);
}); 