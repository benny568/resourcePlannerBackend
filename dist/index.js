"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const prisma_1 = require("./lib/prisma");
// Import routes
const teamMembers_1 = __importDefault(require("./routes/teamMembers"));
const workItems_1 = __importDefault(require("./routes/workItems"));
const sprints_1 = __importDefault(require("./routes/sprints"));
const holidays_1 = __importDefault(require("./routes/holidays"));
const sprintConfig_1 = __importDefault(require("./routes/sprintConfig"));
// Load environment variables
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 3001;
// Middleware
app.use((0, cors_1.default)({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true
}));
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// Request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});
// Routes
app.use('/api/team-members', teamMembers_1.default);
app.use('/api/work-items', workItems_1.default);
app.use('/api/sprints', sprints_1.default);
app.use('/api/holidays', holidays_1.default);
app.use('/api/sprint-config', sprintConfig_1.default);
// Health check endpoint
app.get('/api/health', async (req, res) => {
    try {
        await prisma_1.prisma.$queryRaw `SELECT 1`;
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            database: 'connected'
        });
    }
    catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            database: 'disconnected',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
// Global error handler
app.use((error, req, res, next) => {
    console.error('Global error handler:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
});
// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
});
// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down gracefully...');
    await prisma_1.prisma.$disconnect();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    await prisma_1.prisma.$disconnect();
    process.exit(0);
});
// Start server
app.listen(port, () => {
    console.log(`🚀 Resource Planner API server running on http://localhost:${port}`);
    console.log(`📊 API endpoints available at http://localhost:${port}/api/`);
    console.log(`🏥 Health check at http://localhost:${port}/api/health`);
});
//# sourceMappingURL=index.js.map