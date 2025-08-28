"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const prisma_1 = require("../lib/prisma");
const router = express_1.default.Router();
// GET /api/holidays - Get all public holidays
router.get('/', async (req, res) => {
    try {
        const holidays = await prisma_1.prisma.publicHoliday.findMany({
            orderBy: {
                date: 'asc'
            }
        });
        const response = {
            data: holidays
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error fetching public holidays:', error);
        const apiError = {
            error: 'Failed to fetch public holidays',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
// POST /api/holidays - Create a new public holiday
router.post('/', async (req, res) => {
    try {
        const { name, date, impactPercentage } = req.body;
        if (!name || !date || impactPercentage === undefined) {
            const apiError = {
                error: 'Missing required fields',
                message: 'name, date, and impactPercentage are required'
            };
            return res.status(400).json(apiError);
        }
        if (impactPercentage < 0 || impactPercentage > 100) {
            const apiError = {
                error: 'Invalid impact percentage',
                message: 'Impact percentage must be between 0 and 100'
            };
            return res.status(400).json(apiError);
        }
        const holiday = await prisma_1.prisma.publicHoliday.create({
            data: {
                name,
                date: new Date(date),
                impactPercentage
            }
        });
        const response = {
            data: holiday,
            message: 'Public holiday created successfully'
        };
        res.status(201).json(response);
    }
    catch (error) {
        console.error('Error creating public holiday:', error);
        const apiError = {
            error: 'Failed to create public holiday',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
// PUT /api/holidays/:id - Update a public holiday
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, date, impactPercentage } = req.body;
        const existingHoliday = await prisma_1.prisma.publicHoliday.findUnique({
            where: { id }
        });
        if (!existingHoliday) {
            const apiError = {
                error: 'Public holiday not found'
            };
            return res.status(404).json(apiError);
        }
        if (impactPercentage !== undefined && (impactPercentage < 0 || impactPercentage > 100)) {
            const apiError = {
                error: 'Invalid impact percentage',
                message: 'Impact percentage must be between 0 and 100'
            };
            return res.status(400).json(apiError);
        }
        const updateData = {};
        if (name !== undefined)
            updateData.name = name;
        if (date !== undefined)
            updateData.date = new Date(date);
        if (impactPercentage !== undefined)
            updateData.impactPercentage = impactPercentage;
        const holiday = await prisma_1.prisma.publicHoliday.update({
            where: { id },
            data: updateData
        });
        const response = {
            data: holiday,
            message: 'Public holiday updated successfully'
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error updating public holiday:', error);
        const apiError = {
            error: 'Failed to update public holiday',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
// DELETE /api/holidays/:id - Delete a public holiday
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const existingHoliday = await prisma_1.prisma.publicHoliday.findUnique({
            where: { id }
        });
        if (!existingHoliday) {
            const apiError = {
                error: 'Public holiday not found'
            };
            return res.status(404).json(apiError);
        }
        await prisma_1.prisma.publicHoliday.delete({
            where: { id }
        });
        const response = {
            data: { id },
            message: 'Public holiday deleted successfully'
        };
        res.json(response);
    }
    catch (error) {
        console.error('Error deleting public holiday:', error);
        const apiError = {
            error: 'Failed to delete public holiday',
            message: error instanceof Error ? error.message : 'Unknown error'
        };
        res.status(500).json(apiError);
    }
});
exports.default = router;
//# sourceMappingURL=holidays.js.map