"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const prisma_1 = require("../lib/prisma");
const router = express_1.default.Router();
// GET /api/sprints - Get all sprints with work items (excluding archived)
router.get('/', async (req, res) => {
    try {
        const sprints = await prisma_1.prisma.sprint.findMany({
            where: {
                archived: false
            },
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
// In-memory lock for regeneration operations to prevent race conditions
let regenerationLock = false;
// POST /api/sprints/batch - Batch update/create sprints
router.post('/batch', async (req, res) => {
    const { sprints, isRegeneration } = req.body;
    try {
        // Check for regeneration lock to prevent concurrent operations
        if (isRegeneration && regenerationLock) {
            console.log('⚠️ Regeneration already in progress, rejecting request');
            const apiError = {
                error: 'Regeneration in progress',
                message: 'Sprint regeneration is already in progress. Please wait for it to complete.'
            };
            return res.status(409).json(apiError);
        }
        if (!Array.isArray(sprints) || sprints.length === 0) {
            const apiError = {
                error: 'Invalid input',
                message: 'sprints must be a non-empty array'
            };
            return res.status(400).json(apiError);
        }
        console.log(`📡 Batch sprint operation: processing ${sprints.length} sprints (regeneration: ${isRegeneration})`);
        // Set regeneration lock if this is a regeneration operation
        if (isRegeneration) {
            regenerationLock = true;
            console.log('🔒 Regeneration lock acquired');
        }
        // Use transaction to ensure all operations succeed or fail together
        const results = await prisma_1.prisma.$transaction(async (tx) => {
            // If this is a regeneration operation, first clear existing sprints that would conflict
            if (isRegeneration && sprints.length > 0) {
                // Clear sprints that have the same name pattern (e.g., all Q3/Q4 2025 sprints)
                const sprintNames = sprints.map(s => s.name);
                const sprintDateRange = {
                    start: new Date(Math.min(...sprints.map(s => new Date(s.startDate).getTime()))),
                    end: new Date(Math.max(...sprints.map(s => new Date(s.endDate).getTime())))
                };
                console.log(`🗑️ Clearing existing sprints that overlap with regeneration range`);
                console.log(`📅 Date range: ${sprintDateRange.start.toISOString()} to ${sprintDateRange.end.toISOString()}`);
                console.log(`🏷️ Sprint names: ${sprintNames.join(', ')}`);
                await tx.sprint.deleteMany({
                    where: {
                        OR: [
                            // Clear sprints with matching names
                            { name: { in: sprintNames } },
                            // Clear sprints that overlap with the date range
                            {
                                AND: [
                                    { startDate: { lte: sprintDateRange.end } },
                                    { endDate: { gte: sprintDateRange.start } }
                                ]
                            }
                        ],
                        archived: false
                    }
                });
            }
            const updatedSprints = [];
            for (const sprintData of sprints) {
                const { name, startDate, endDate, plannedVelocity, actualVelocity } = sprintData;
                if (!name || !startDate || !endDate || !plannedVelocity) {
                    throw new Error(`Missing required fields for sprint: ${name || 'unnamed'}`);
                }
                // For regeneration, always create new sprints since we cleared existing ones
                if (isRegeneration) {
                    console.log(`➕ Creating new sprint: ${name}`);
                    const sprint = await tx.sprint.create({
                        data: {
                            name,
                            startDate: new Date(startDate),
                            endDate: new Date(endDate),
                            plannedVelocity,
                            ...(actualVelocity !== undefined && { actualVelocity })
                        }
                    });
                    updatedSprints.push(sprint);
                }
                else {
                    // For non-regeneration operations, check for existing sprints
                    const existingSprint = await tx.sprint.findFirst({
                        where: {
                            name,
                            startDate: new Date(startDate),
                            endDate: new Date(endDate),
                            archived: false
                        }
                    });
                    let sprint;
                    if (existingSprint) {
                        // Update existing sprint
                        console.log(`🔄 Updating existing sprint: ${name}`);
                        sprint = await tx.sprint.update({
                            where: { id: existingSprint.id },
                            data: {
                                plannedVelocity,
                                ...(actualVelocity !== undefined && { actualVelocity })
                            }
                        });
                    }
                    else {
                        // Create new sprint
                        console.log(`➕ Creating new sprint: ${name}`);
                        sprint = await tx.sprint.create({
                            data: {
                                name,
                                startDate: new Date(startDate),
                                endDate: new Date(endDate),
                                plannedVelocity,
                                ...(actualVelocity !== undefined && { actualVelocity })
                            }
                        });
                    }
                    updatedSprints.push(sprint);
                }
            }
            return updatedSprints;
        });
        const response = {
            data: results,
            message: `Batch operation completed: ${results.length} sprints processed`
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error in batch sprint operation:', error);
        const apiError = {
            error: 'Failed to process batch sprint operation',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
    finally {
        // Always release regeneration lock
        if (isRegeneration) {
            regenerationLock = false;
            console.log('🔓 Regeneration lock released');
        }
    }
});
// DELETE /api/sprints/:id - Archive a sprint (mark as archived instead of deleting)
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
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
                archived: true
            }
        });
        const response = {
            data: sprint,
            message: 'Sprint archived successfully'
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error archiving sprint:', error);
        const apiError = {
            error: 'Failed to archive sprint',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
exports.default = router;
//# sourceMappingURL=sprints.js.map