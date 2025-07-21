"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const teamMembers_1 = __importDefault(require("./routes/teamMembers"));
const workItems_1 = __importDefault(require("./routes/workItems"));
const sprints_1 = __importDefault(require("./routes/sprints"));
const holidays_1 = __importDefault(require("./routes/holidays"));
const sprintConfig_1 = __importDefault(require("./routes/sprintConfig"));
const jiraIntegration_1 = __importDefault(require("./routes/jiraIntegration"));
const client_1 = require("@prisma/client");
const app = (0, express_1.default)();
const port = 3001;
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Initialize Prisma
const prisma = new client_1.PrismaClient();
// Routes
app.use('/api/team-members', teamMembers_1.default);
app.use('/api/work-items', workItems_1.default);
app.use('/api/sprints', sprints_1.default);
app.use('/api/holidays', holidays_1.default);
app.use('/api/sprint-config', sprintConfig_1.default);
app.use('/api/jira', jiraIntegration_1.default);
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
app.use((error, req, res, next) => {
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
//# sourceMappingURL=index.js.map