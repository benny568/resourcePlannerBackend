import express from 'express';
import { prisma } from '../lib/prisma';
import { PublicHolidayData, ApiResponse, ApiError } from '../types';

const router = express.Router();

// GET /api/holidays - Get all public holidays
router.get('/', async (req, res) => {
  try {
    const holidays = await prisma.publicHoliday.findMany({
      orderBy: {
        date: 'asc'
      }
    });

    const response: ApiResponse<typeof holidays> = {
      data: holidays
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching public holidays:', error);
    const apiError: ApiError = {
      error: 'Failed to fetch public holidays',
      message: error instanceof Error ? error.message : 'Unknown error'
    };
    res.status(500).json(apiError);
  }
});

// POST /api/holidays - Create a new public holiday
router.post('/', async (req, res) => {
  try {
    const { name, date, impactPercentage }: PublicHolidayData = req.body;

    if (!name || !date || impactPercentage === undefined) {
      const apiError: ApiError = {
        error: 'Missing required fields',
        message: 'name, date, and impactPercentage are required'
      };
      return res.status(400).json(apiError);
    }

    if (impactPercentage < 0 || impactPercentage > 100) {
      const apiError: ApiError = {
        error: 'Invalid impact percentage',
        message: 'Impact percentage must be between 0 and 100'
      };
      return res.status(400).json(apiError);
    }

    const holiday = await prisma.publicHoliday.create({
      data: {
        name,
        date: new Date(date),
        impactPercentage
      }
    });

    const response: ApiResponse<typeof holiday> = {
      data: holiday,
      message: 'Public holiday created successfully'
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Error creating public holiday:', error);
    const apiError: ApiError = {
      error: 'Failed to create public holiday',
      message: error instanceof Error ? error.message : 'Unknown error'
    };
    res.status(500).json(apiError);
  }
});

// DELETE /api/holidays/:id - Delete a public holiday
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const existingHoliday = await prisma.publicHoliday.findUnique({
      where: { id }
    });

    if (!existingHoliday) {
      const apiError: ApiError = {
        error: 'Public holiday not found'
      };
      return res.status(404).json(apiError);
    }

    await prisma.publicHoliday.delete({
      where: { id }
    });

    const response: ApiResponse<{ id: string }> = {
      data: { id },
      message: 'Public holiday deleted successfully'
    };

    res.json(response);
  } catch (error) {
    console.error('Error deleting public holiday:', error);
    const apiError: ApiError = {
      error: 'Failed to delete public holiday',
      message: error instanceof Error ? error.message : 'Unknown error'
    };
    res.status(500).json(apiError);
  }
});

export default router; 