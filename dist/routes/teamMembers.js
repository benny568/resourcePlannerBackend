"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const prisma_1 = require("../lib/prisma");
const router = express_1.default.Router();
// GET /api/team-members - Get all team members with their personal holidays
router.get('/', async (req, res) => {
    try {
        const teamMembers = await prisma_1.prisma.teamMember.findMany({
            include: {
                personalHolidays: true
            },
            orderBy: {
                createdAt: 'asc'
            }
        });
        const response = {
            data: teamMembers
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error fetching team members:', error);
        const apiError = {
            error: 'Failed to fetch team members',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
// GET /api/team-members/:id - Get a specific team member
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const teamMember = await prisma_1.prisma.teamMember.findUnique({
            where: { id },
            include: {
                personalHolidays: true
            }
        });
        if (!teamMember) {
            const apiError = {
                error: 'Team member not found'
            };
            return res.status(404).json(apiError);
        }
        const response = {
            data: teamMember
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error fetching team member:', error);
        const apiError = {
            error: 'Failed to fetch team member',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
// POST /api/team-members - Create a new team member
router.post('/', async (req, res) => {
    try {
        const { name, capacity, skills } = req.body;
        if (!name || capacity === undefined || !skills || !Array.isArray(skills)) {
            const apiError = {
                error: 'Missing required fields',
                message: 'name, capacity, and skills are required'
            };
            return res.status(400).json(apiError);
        }
        if (capacity < 0 || capacity > 100) {
            const apiError = {
                error: 'Invalid capacity',
                message: 'Capacity must be between 0 and 100'
            };
            return res.status(400).json(apiError);
        }
        const teamMember = await prisma_1.prisma.teamMember.create({
            data: {
                name,
                capacity,
                skills
            },
            include: {
                personalHolidays: true
            }
        });
        const response = {
            data: teamMember,
            message: 'Team member created successfully'
        };
        res.status(201).json(response);
    }
    catch (error) {
        console.error('Error creating team member:', error);
        const apiError = {
            error: 'Failed to create team member',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
// PUT /api/team-members/:id - Update a team member
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, capacity, skills } = req.body;
        // Check if team member exists
        const existingTeamMember = await prisma_1.prisma.teamMember.findUnique({
            where: { id }
        });
        if (!existingTeamMember) {
            const apiError = {
                error: 'Team member not found'
            };
            return res.status(404).json(apiError);
        }
        // Validate capacity if provided
        if (capacity !== undefined && (capacity < 0 || capacity > 100)) {
            const apiError = {
                error: 'Invalid capacity',
                message: 'Capacity must be between 0 and 100'
            };
            return res.status(400).json(apiError);
        }
        const teamMember = await prisma_1.prisma.teamMember.update({
            where: { id },
            data: {
                ...(name && { name }),
                ...(capacity !== undefined && { capacity }),
                ...(skills && { skills })
            },
            include: {
                personalHolidays: true
            }
        });
        const response = {
            data: teamMember,
            message: 'Team member updated successfully'
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error updating team member:', error);
        const apiError = {
            error: 'Failed to update team member',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
// DELETE /api/team-members/:id - Delete a team member
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // Check if team member exists
        const existingTeamMember = await prisma_1.prisma.teamMember.findUnique({
            where: { id }
        });
        if (!existingTeamMember) {
            const apiError = {
                error: 'Team member not found'
            };
            return res.status(404).json(apiError);
        }
        await prisma_1.prisma.teamMember.delete({
            where: { id }
        });
        const response = {
            data: { id },
            message: 'Team member deleted successfully'
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error deleting team member:', error);
        const apiError = {
            error: 'Failed to delete team member',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
// POST /api/team-members/:id/holidays - Add personal holiday
router.post('/:id/holidays', async (req, res) => {
    try {
        const { id } = req.params;
        const { startDate, endDate, description } = req.body;
        if (!startDate || !endDate) {
            const apiError = {
                error: 'Missing required fields',
                message: 'startDate and endDate are required'
            };
            return res.status(400).json(apiError);
        }
        // Check if team member exists
        const teamMember = await prisma_1.prisma.teamMember.findUnique({
            where: { id }
        });
        if (!teamMember) {
            const apiError = {
                error: 'Team member not found'
            };
            return res.status(404).json(apiError);
        }
        const holiday = await prisma_1.prisma.personalHoliday.create({
            data: {
                teamMemberId: id,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                description
            }
        });
        const response = {
            data: holiday,
            message: 'Personal holiday added successfully'
        };
        res.status(201).json(response);
    }
    catch (error) {
        console.error('Error adding personal holiday:', error);
        const apiError = {
            error: 'Failed to add personal holiday',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
// DELETE /api/team-members/:id/holidays/:holidayId - Remove personal holiday
router.delete('/:id/holidays/:holidayId', async (req, res) => {
    try {
        const { id, holidayId } = req.params;
        // Check if holiday exists and belongs to the team member
        const holiday = await prisma_1.prisma.personalHoliday.findFirst({
            where: {
                id: holidayId,
                teamMemberId: id
            }
        });
        if (!holiday) {
            const apiError = {
                error: 'Personal holiday not found'
            };
            return res.status(404).json(apiError);
        }
        await prisma_1.prisma.personalHoliday.delete({
            where: { id: holidayId }
        });
        const response = {
            data: { id: holidayId },
            message: 'Personal holiday removed successfully'
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error removing personal holiday:', error);
        const apiError = {
            error: 'Failed to remove personal holiday',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
exports.default = router;
//# sourceMappingURL=teamMembers.js.map