"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const prisma_1 = require("../lib/prisma");
const router = express_1.default.Router();
// GET /api/work-items - Get all work items with dependencies and sprint assignments
router.get('/', async (req, res) => {
    try {
        const workItems = await prisma_1.prisma.workItem.findMany({
            include: {
                dependencies: {
                    include: {
                        dependsOn: true
                    }
                },
                sprintAssignments: {
                    include: {
                        sprint: true
                    }
                }
            },
            orderBy: {
                createdAt: 'asc'
            }
        });
        // Transform the data to match frontend expectations
        const transformedWorkItems = workItems.map(item => ({
            ...item,
            dependencies: item.dependencies.map(dep => dep.dependsOnId),
            assignedSprints: item.sprintAssignments.map(assignment => assignment.sprintId)
        }));
        console.log(`🗃️ RAW DATABASE QUERY: Retrieved ${workItems.length} total work items from database`);
        console.log(`🔍 Work items breakdown:`, {
            totalItems: transformedWorkItems.length,
            epics: transformedWorkItems.filter(item => item.isEpic).length,
            epicChildren: transformedWorkItems.filter(item => item.epicId).length,
            regular: transformedWorkItems.filter(item => !item.isEpic && !item.epicId).length
        });
        // Deduplicate epic work items by jiraId (keep the most recent one by creation date)
        const epicMap = new Map();
        const epics = transformedWorkItems.filter((item) => item.isEpic);
        for (const epic of epics) {
            const existingEpic = epicMap.get(epic.jiraId);
            if (!existingEpic || new Date(epic.createdAt) > new Date(existingEpic.createdAt)) {
                epicMap.set(epic.jiraId, epic);
            }
        }
        const deduplicatedEpics = Array.from(epicMap.values());
        const epicWorkItemIds = new Set(deduplicatedEpics.map((item) => item.id));
        const epicJiraIds = new Set(deduplicatedEpics.map((item) => item.jiraId));
        console.log(`🔍 Found ${epics.length} epic work items, deduplicated to ${deduplicatedEpics.length}`);
        if (epics.length > deduplicatedEpics.length) {
            console.log(`⚠️  Removed ${epics.length - deduplicatedEpics.length} duplicate epic(s)`);
        }
        // Also create a map of ALL epic IDs (including duplicates) to their jiraIds for filtering
        const allEpicIdToJiraId = new Map();
        for (const epic of epics) {
            allEpicIdToJiraId.set(epic.id, epic.jiraId);
        }
        // Filter out epic children and non-deduplicated epics
        const finalWorkItems = transformedWorkItems
            .filter((item) => {
            // Include epic children as individual work items for drag and drop functionality
            if (item.epicId) {
                const epicJiraId = allEpicIdToJiraId.get(item.epicId);
                if (epicWorkItemIds.has(item.epicId) || epicJiraIds.has(epicJiraId)) {
                    console.log(`✅ Including epic child for drag and drop: ${item.title} (epicId: ${item.epicId})`);
                    return true; // Include epic children as separate work items for drag and drop
                }
            }
            // Exclude duplicate epics (keep only deduplicated ones)
            if (item.isEpic && !epicWorkItemIds.has(item.id)) {
                console.log(`🚫 Filtering out duplicate epic: ${item.title} (id: ${item.id})`);
                return false; // Don't include duplicate epic work items
            }
            return true; // Include all other items
        })
            .map((item) => {
            if (item.isEpic) {
                // Find all work items that belong to this epic (check both DB ID and Jira ID)
                const children = transformedWorkItems.filter((child) => child.epicId === item.id || child.epicId === item.jiraId);
                console.log(`📋 Epic "${item.title}" has ${children.length} children`);
                return {
                    ...item,
                    children: children.length > 0 ? children : undefined
                };
            }
            return item;
        });
        const response = {
            data: finalWorkItems
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error fetching work items:', error);
        const apiError = {
            error: 'Failed to fetch work items',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
// GET /api/work-items/:id - Get a specific work item
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const workItem = await prisma_1.prisma.workItem.findUnique({
            where: { id },
            include: {
                dependencies: {
                    include: {
                        dependsOn: true
                    }
                },
                sprintAssignments: {
                    include: {
                        sprint: true
                    }
                }
            }
        });
        if (!workItem) {
            const apiError = {
                error: 'Work item not found'
            };
            return res.status(404).json(apiError);
        }
        // Transform the data to match frontend expectations
        const transformedWorkItem = {
            ...workItem,
            dependencies: workItem.dependencies.map(dep => dep.dependsOnId),
            assignedSprints: workItem.sprintAssignments.map(assignment => assignment.sprintId)
        };
        const response = {
            data: transformedWorkItem
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error fetching work item:', error);
        const apiError = {
            error: 'Failed to fetch work item',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
// POST /api/work-items - Create a new work item
router.post('/', async (req, res) => {
    try {
        let { title, description, estimateStoryPoints, requiredCompletionDate, requiredSkills, dependencies = [], status = 'Not Started', jiraId, jiraStatus, epicId, isEpic = false, priority = 'Medium' } = req.body;
        if (!title || !estimateStoryPoints || !requiredCompletionDate || !requiredSkills || (Array.isArray(requiredSkills) && requiredSkills.length === 0)) {
            console.error('❌ Work item validation failed:', {
                title: title || 'MISSING',
                estimateStoryPoints: estimateStoryPoints || 'MISSING',
                requiredCompletionDate: requiredCompletionDate || 'MISSING',
                requiredSkills: requiredSkills || 'MISSING',
                requiredSkillsLength: Array.isArray(requiredSkills) ? requiredSkills.length : 'NOT_ARRAY',
                fullRequestBody: JSON.stringify(req.body, null, 2)
            });
            const apiError = {
                error: 'Missing required fields',
                message: 'title, estimateStoryPoints, requiredCompletionDate, and requiredSkills are required'
            };
            return res.status(400).json(apiError);
        }
        // Validate and normalize story points
        if (estimateStoryPoints <= 0) {
            console.error('❌ Invalid story points validation failed:', {
                estimateStoryPoints,
                type: typeof estimateStoryPoints,
                title,
                jiraId
            });
            const apiError = {
                error: 'Invalid story points',
                message: 'Story points must be greater than 0'
            };
            return res.status(400).json(apiError);
        }
        // Cap story points at reasonable maximum to prevent massive values
        if (estimateStoryPoints > 100) {
            console.warn(`⚠️ Unreasonable story points value ${estimateStoryPoints} for work item "${title}", capping at 20`);
            estimateStoryPoints = 20;
        }
        // Validate dependencies exist
        if (dependencies.length > 0) {
            const existingDependencies = await prisma_1.prisma.workItem.findMany({
                where: {
                    id: { in: dependencies }
                }
            });
            if (existingDependencies.length !== dependencies.length) {
                const apiError = {
                    error: 'Invalid dependencies',
                    message: 'Some dependency work items do not exist'
                };
                return res.status(400).json(apiError);
            }
        }
        // Check for duplicate epic work items by jiraId
        if (isEpic && jiraId) {
            const existingEpic = await prisma_1.prisma.workItem.findFirst({
                where: {
                    jiraId,
                    isEpic: true
                }
            });
            if (existingEpic) {
                console.log(`⚠️  Preventing duplicate epic creation for jiraId: ${jiraId} (existing ID: ${existingEpic.id})`);
                const apiError = {
                    error: 'Duplicate epic',
                    message: `Epic with Jira ID ${jiraId} already exists as work item ${existingEpic.id}`
                };
                return res.status(409).json(apiError);
            }
        }
        // Create work item and dependencies in a transaction
        const result = await prisma_1.prisma.$transaction(async (tx) => {
            const workItem = await tx.workItem.create({
                data: {
                    title,
                    description,
                    estimateStoryPoints,
                    requiredCompletionDate: new Date(requiredCompletionDate),
                    requiredSkills,
                    status,
                    jiraId,
                    jiraStatus,
                    epicId,
                    isEpic,
                    priority
                }
            });
            // Create dependency relationships
            if (dependencies.length > 0) {
                await tx.workItemDependency.createMany({
                    data: dependencies.map(depId => ({
                        workItemId: workItem.id,
                        dependsOnId: depId
                    }))
                });
            }
            return workItem;
        });
        const response = {
            data: { ...result, dependencies, assignedSprints: [] },
            message: 'Work item created successfully'
        };
        res.status(201).json(response);
    }
    catch (error) {
        console.error('Error creating work item:', error);
        const apiError = {
            error: 'Failed to create work item',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
// PUT /api/work-items/:id - Update a work item
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        let { title, description, estimateStoryPoints, requiredCompletionDate, requiredSkills, dependencies, status, jiraId, jiraStatus, epicId, isEpic, priority } = req.body;
        // Check if work item exists
        const existingWorkItem = await prisma_1.prisma.workItem.findUnique({
            where: { id }
        });
        if (!existingWorkItem) {
            const apiError = {
                error: 'Work item not found'
            };
            return res.status(404).json(apiError);
        }
        // Validate and normalize story points if provided
        if (estimateStoryPoints !== undefined) {
            if (estimateStoryPoints <= 0) {
                const apiError = {
                    error: 'Invalid story points',
                    message: 'Story points must be greater than 0'
                };
                return res.status(400).json(apiError);
            }
            // Cap story points at reasonable maximum to prevent massive values
            if (estimateStoryPoints > 100) {
                console.warn(`⚠️ Unreasonable story points value ${estimateStoryPoints} for work item update, capping at 20`);
                estimateStoryPoints = 20;
            }
        }
        // Validate dependencies if provided
        if (dependencies) {
            // Prevent self-dependency
            if (dependencies.includes(id)) {
                const apiError = {
                    error: 'Invalid dependencies',
                    message: 'Work item cannot depend on itself'
                };
                return res.status(400).json(apiError);
            }
            const existingDependencies = await prisma_1.prisma.workItem.findMany({
                where: {
                    id: { in: dependencies }
                }
            });
            if (existingDependencies.length !== dependencies.length) {
                const apiError = {
                    error: 'Invalid dependencies',
                    message: 'Some dependency work items do not exist'
                };
                return res.status(400).json(apiError);
            }
        }
        // Update work item and dependencies in a transaction
        const result = await prisma_1.prisma.$transaction(async (tx) => {
            const workItem = await tx.workItem.update({
                where: { id },
                data: {
                    ...(title && { title }),
                    ...(description !== undefined && { description }),
                    ...(estimateStoryPoints !== undefined && { estimateStoryPoints }),
                    ...(requiredCompletionDate && { requiredCompletionDate: new Date(requiredCompletionDate) }),
                    ...(requiredSkills && { requiredSkills }),
                    ...(status && { status }),
                    ...(jiraId !== undefined && { jiraId }),
                    ...(jiraStatus !== undefined && { jiraStatus }),
                    ...(epicId !== undefined && { epicId }),
                    ...(isEpic !== undefined && { isEpic }),
                    ...(priority !== undefined && { priority })
                }
            });
            // Update dependencies if provided
            if (dependencies !== undefined) {
                // Remove existing dependencies
                await tx.workItemDependency.deleteMany({
                    where: { workItemId: id }
                });
                // Add new dependencies
                if (dependencies.length > 0) {
                    await tx.workItemDependency.createMany({
                        data: dependencies.map(depId => ({
                            workItemId: id,
                            dependsOnId: depId
                        }))
                    });
                }
            }
            return workItem;
        });
        const response = {
            data: { ...result, dependencies: dependencies || [], assignedSprints: [] },
            message: 'Work item updated successfully'
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error updating work item:', error);
        const apiError = {
            error: 'Failed to update work item',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
// DELETE /api/work-items/selective-reset - Selectively reset database based on data types
router.delete('/selective-reset', async (req, res) => {
    try {
        const { dataTypes } = req.body;
        if (!dataTypes || !Array.isArray(dataTypes) || dataTypes.length === 0) {
            const apiError = {
                error: 'Invalid request',
                message: 'dataTypes array is required and must contain at least one item'
            };
            return res.status(400).json(apiError);
        }
        console.log('🚨 Starting selective database reset...', dataTypes);
        const deletionResults = [];
        let deletedCounts = {};
        // Always delete dependencies first if work items are being deleted
        if (dataTypes.includes('workItems') || dataTypes.includes('dependencies')) {
            const sprintAssignments = await prisma_1.prisma.sprintWorkItem.deleteMany({});
            const dependencies = await prisma_1.prisma.workItemDependency.deleteMany({});
            deletionResults.push(`✅ Cleared ${sprintAssignments.count} sprint assignments`);
            deletionResults.push(`✅ Cleared ${dependencies.count} work item dependencies`);
            deletedCounts.sprintAssignments = sprintAssignments.count;
            deletedCounts.dependencies = dependencies.count;
        }
        // Delete personal holidays
        if (dataTypes.includes('privateHolidays')) {
            const result = await prisma_1.prisma.personalHoliday.deleteMany({});
            deletionResults.push(`✅ Cleared ${result.count} personal holidays`);
            deletedCounts.personalHolidays = result.count;
        }
        // Delete public holidays
        if (dataTypes.includes('publicHolidays')) {
            const result = await prisma_1.prisma.publicHoliday.deleteMany({});
            deletionResults.push(`✅ Cleared ${result.count} public holidays`);
            deletedCounts.publicHolidays = result.count;
        }
        // Delete work items (includes epics)
        if (dataTypes.includes('workItems')) {
            const result = await prisma_1.prisma.workItem.deleteMany({});
            deletionResults.push(`✅ Cleared ${result.count} work items and epics`);
            deletedCounts.workItems = result.count;
        }
        // Delete sprints
        if (dataTypes.includes('sprints')) {
            // If work items weren't deleted, we need to clear sprint assignments first
            if (!dataTypes.includes('workItems')) {
                const sprintAssignments = await prisma_1.prisma.sprintWorkItem.deleteMany({});
                deletionResults.push(`✅ Cleared ${sprintAssignments.count} sprint assignments`);
                deletedCounts.sprintAssignments = sprintAssignments.count;
            }
            const result = await prisma_1.prisma.sprint.deleteMany({});
            deletionResults.push(`✅ Cleared ${result.count} sprints`);
            deletedCounts.sprints = result.count;
        }
        // Delete team members
        if (dataTypes.includes('teamMembers')) {
            const result = await prisma_1.prisma.teamMember.deleteMany({});
            deletionResults.push(`✅ Cleared ${result.count} team members`);
            deletedCounts.teamMembers = result.count;
        }
        const summary = deletionResults.join(', ');
        console.log('🎉 Selective database reset completed:', summary);
        const response = {
            data: {
                summary,
                deletedCounts
            },
            message: 'Selected data types deleted successfully'
        };
        res.json(response);
    }
    catch (error) {
        console.error('❌ Error in selective database reset:', error);
        const apiError = {
            error: 'Failed to perform selective reset',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
// DELETE /api/work-items/:id - Delete a work item
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // Check if work item exists
        const existingWorkItem = await prisma_1.prisma.workItem.findUnique({
            where: { id }
        });
        if (!existingWorkItem) {
            const apiError = {
                error: 'Work item not found'
            };
            return res.status(404).json(apiError);
        }
        await prisma_1.prisma.workItem.delete({
            where: { id }
        });
        const response = {
            data: { id },
            message: 'Work item deleted successfully'
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error deleting work item:', error);
        const apiError = {
            error: 'Failed to delete work item',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
// POST /api/work-items/:id/assign-sprint - Assign work item to a sprint
router.post('/:id/assign-sprint', async (req, res) => {
    try {
        const { id } = req.params;
        const { sprintId } = req.body;
        if (!sprintId) {
            const apiError = {
                error: 'Missing sprint ID',
                message: 'sprintId is required'
            };
            return res.status(400).json(apiError);
        }
        // Check if work item and sprint exist
        const [workItem, sprint] = await Promise.all([
            prisma_1.prisma.workItem.findUnique({ where: { id } }),
            prisma_1.prisma.sprint.findUnique({ where: { id: sprintId } })
        ]);
        if (!workItem) {
            const apiError = {
                error: 'Work item not found'
            };
            return res.status(404).json(apiError);
        }
        if (!sprint) {
            const apiError = {
                error: 'Sprint not found'
            };
            return res.status(404).json(apiError);
        }
        // Check if already assigned
        const existingAssignment = await prisma_1.prisma.sprintWorkItem.findUnique({
            where: {
                sprintId_workItemId: {
                    sprintId,
                    workItemId: id
                }
            }
        });
        if (existingAssignment) {
            const apiError = {
                error: 'Work item already assigned to this sprint'
            };
            return res.status(400).json(apiError);
        }
        const assignment = await prisma_1.prisma.sprintWorkItem.create({
            data: {
                sprintId,
                workItemId: id
            }
        });
        const response = {
            data: assignment,
            message: 'Work item assigned to sprint successfully'
        };
        res.status(201).json(response);
    }
    catch (error) {
        console.error('Error assigning work item to sprint:', error);
        const apiError = {
            error: 'Failed to assign work item to sprint',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
// DELETE /api/work-items/:id/assign-sprint/:sprintId - Remove work item from sprint
router.delete('/:id/assign-sprint/:sprintId', async (req, res) => {
    try {
        const { id, sprintId } = req.params;
        const existingAssignment = await prisma_1.prisma.sprintWorkItem.findUnique({
            where: {
                sprintId_workItemId: {
                    sprintId,
                    workItemId: id
                }
            }
        });
        if (!existingAssignment) {
            const apiError = {
                error: 'Assignment not found'
            };
            return res.status(404).json(apiError);
        }
        await prisma_1.prisma.sprintWorkItem.delete({
            where: {
                sprintId_workItemId: {
                    sprintId,
                    workItemId: id
                }
            }
        });
        const response = {
            data: { workItemId: id, sprintId },
            message: 'Work item removed from sprint successfully'
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error removing work item from sprint:', error);
        const apiError = {
            error: 'Failed to remove work item from sprint',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
// DELETE /api/work-items/clear-all - Clear all work items (for testing)
router.delete('/clear-all', async (req, res) => {
    try {
        console.log('🧹 Clearing all work items from database...');
        // Delete all sprint assignments first (foreign key constraint)
        await prisma_1.prisma.sprintWorkItem.deleteMany({});
        console.log('✅ Cleared all sprint assignments');
        // Delete all work item dependencies
        await prisma_1.prisma.workItemDependency.deleteMany({});
        console.log('✅ Cleared all work item dependencies');
        // Delete all work items
        const deletedCount = await prisma_1.prisma.workItem.deleteMany({});
        console.log(`✅ Deleted ${deletedCount.count} work items`);
        const response = {
            data: { deletedCount: deletedCount.count },
            message: 'All work items cleared successfully'
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error clearing work items:', error);
        const apiError = {
            error: 'Failed to clear work items',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
// DELETE /api/work-items/reset-database - Reset entire database to start fresh
router.delete('/reset-database', async (req, res) => {
    try {
        console.log('🚨 RESETTING ENTIRE DATABASE - Starting complete wipe...');
        // Delete all data in the correct order (respecting foreign key constraints)
        await prisma_1.prisma.sprintWorkItem.deleteMany({});
        console.log('✅ Cleared all sprint work item assignments');
        await prisma_1.prisma.workItemDependency.deleteMany({});
        console.log('✅ Cleared all work item dependencies');
        await prisma_1.prisma.personalHoliday.deleteMany({});
        console.log('✅ Cleared all personal holidays');
        await prisma_1.prisma.publicHoliday.deleteMany({});
        console.log('✅ Cleared all public holidays');
        await prisma_1.prisma.workItem.deleteMany({});
        console.log('✅ Cleared all work items');
        await prisma_1.prisma.sprint.deleteMany({});
        console.log('✅ Cleared all sprints');
        await prisma_1.prisma.teamMember.deleteMany({});
        console.log('✅ Cleared all team members');
        const response = {
            data: { message: 'Database reset completed successfully' },
            message: 'All data cleared - database is now empty and ready for fresh setup'
        };
        console.log('🎉 Database reset completed successfully!');
        res.json(response);
    }
    catch (error) {
        console.error('❌ Error resetting database:', error);
        const apiError = {
            error: 'Failed to reset database',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
exports.default = router;
