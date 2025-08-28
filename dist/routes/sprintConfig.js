"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const prisma_1 = require("../lib/prisma");
const router = express_1.default.Router();
// GET /api/sprint-config - Get sprint configuration (returns first config or default)
router.get('/', async (req, res) => {
    try {
        const config = await prisma_1.prisma.sprintConfig.findFirst({
            orderBy: {
                createdAt: 'desc'
            }
        });
        if (!config) {
            // Return default configuration if none exists
            const defaultConfig = {
                id: '',
                firstSprintStartDate: new Date(),
                sprintDurationDays: 14,
                defaultVelocity: 20,
                startingQuarterSprintNumber: 1,
                createdAt: new Date(),
                updatedAt: new Date()
            };
            const response = {
                data: defaultConfig
            };
            return res.json(response);
        }
        const response = {
            data: config
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error fetching sprint config:', error);
        const apiError = {
            error: 'Failed to fetch sprint config',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
// POST /api/sprint-config - Create or update sprint configuration
router.post('/', async (req, res) => {
    try {
        const { firstSprintStartDate, sprintDurationDays, defaultVelocity, startingQuarterSprintNumber } = req.body;
        if (!firstSprintStartDate || !sprintDurationDays || !defaultVelocity || startingQuarterSprintNumber === undefined) {
            const apiError = {
                error: 'Missing required fields',
                message: 'firstSprintStartDate, sprintDurationDays, defaultVelocity, and startingQuarterSprintNumber are required'
            };
            return res.status(400).json(apiError);
        }
        if (sprintDurationDays <= 0 || defaultVelocity <= 0 || startingQuarterSprintNumber <= 0) {
            const apiError = {
                error: 'Invalid values',
                message: 'Sprint duration, default velocity, and starting quarter sprint number must be greater than 0'
            };
            return res.status(400).json(apiError);
        }
        // Delete existing config and create new one (only keep latest)
        await prisma_1.prisma.sprintConfig.deleteMany({});
        const config = await prisma_1.prisma.sprintConfig.create({
            data: {
                firstSprintStartDate: new Date(firstSprintStartDate),
                sprintDurationDays,
                defaultVelocity,
                startingQuarterSprintNumber
            }
        });
        const response = {
            data: config,
            message: 'Sprint configuration saved successfully'
        };
        res.status(201).json(response);
    }
    catch (error) {
        console.error('Error saving sprint config:', error);
        const apiError = {
            error: 'Failed to save sprint config',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
exports.default = router;
//# sourceMappingURL=sprintConfig.js.map