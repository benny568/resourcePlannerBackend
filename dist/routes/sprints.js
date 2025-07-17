"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const prisma_1 = require("../lib/prisma");
const router = express_1.default.Router();
// GET /api/sprints - Get all sprints with work items
router.get('/', async (req, res) => {
    try {
        const sprints = await prisma_1.prisma.sprint.findMany({
            include: {
                workItemAssignments: {
                    include: {
                        workItem: true
                    }
                }
            },
            orderBy: {
                startDate: 'asc'
            }
        });
        const transformedSprints = sprints.map(sprint => ({
            ...sprint,
            workItems: sprint.workItemAssignments.map(assignment => assignment.workItemId)
        }));
        const response = {
            data: transformedSprints
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error fetching sprints:', error);
        const apiError = {
            error: 'Failed to fetch sprints',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
// POST /api/sprints - Create a new sprint
router.post('/', async (req, res) => {
    try {
        const { name, startDate, endDate, plannedVelocity, actualVelocity } = req.body;
        if (!name || !startDate || !endDate || !plannedVelocity) {
            const apiError = {
                error: 'Missing required fields',
                message: 'name, startDate, endDate, and plannedVelocity are required'
            };
            return res.status(400).json(apiError);
        }
        const sprint = await prisma_1.prisma.sprint.create({
            data: {
                name,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                plannedVelocity,
                ...(actualVelocity !== undefined && { actualVelocity })
            }
        });
        const response = {
            data: { ...sprint, workItems: [] },
            message: 'Sprint created successfully'
        };
        res.status(201).json(response);
    }
    catch (error) {
        console.error('Error creating sprint:', error);
        const apiError = {
            error: 'Failed to create sprint',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
// PUT /api/sprints/:id - Update a sprint
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, startDate, endDate, plannedVelocity, actualVelocity } = req.body;
        const existingSprint = await prisma_1.prisma.sprint.findUnique({
            where: { id }
        });
        if (!existingSprint) {
            const apiError = {
                error: 'Sprint not found'
            };
            return res.status(404).json(apiError);
        }
        const sprint = await prisma_1.prisma.sprint.update({
            where: { id },
            data: {
                ...(name && { name }),
                ...(startDate && { startDate: new Date(startDate) }),
                ...(endDate && { endDate: new Date(endDate) }),
                ...(plannedVelocity !== undefined && { plannedVelocity }),
                ...(actualVelocity !== undefined && { actualVelocity })
            }
        });
        const response = {
            data: sprint,
            message: 'Sprint updated successfully'
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error updating sprint:', error);
        const apiError = {
            error: 'Failed to update sprint',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
exports.default = router;
//# sourceMappingURL=sprints.js.map