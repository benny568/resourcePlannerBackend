import express from 'express';
import { prisma } from '../lib/prisma';
import { SprintConfigData, ApiResponse, ApiError } from '../types';

const router = express.Router();

// GET /api/sprint-config - Get sprint configuration (returns first config or default)
router.get('/', async (req, res) => {
  try {
    const config = await prisma.sprintConfig.findFirst({
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
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const response: ApiResponse<typeof defaultConfig> = {
        data: defaultConfig
      };

      return res.json(response);
    }

    const response: ApiResponse<typeof config> = {
      data: config
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching sprint config:', error);
    const apiError: ApiError = {
      error: 'Failed to fetch sprint config',
      message: error instanceof Error ? error.message : 'Unknown error'
    };
    res.status(500).json(apiError);
  }
});

// POST /api/sprint-config - Create or update sprint configuration
router.post('/', async (req, res) => {
  try {
    const { firstSprintStartDate, sprintDurationDays, defaultVelocity }: SprintConfigData = req.body;

    if (!firstSprintStartDate || !sprintDurationDays || !defaultVelocity) {
      const apiError: ApiError = {
        error: 'Missing required fields',
        message: 'firstSprintStartDate, sprintDurationDays, and defaultVelocity are required'
      };
      return res.status(400).json(apiError);
    }

    if (sprintDurationDays <= 0 || defaultVelocity <= 0) {
      const apiError: ApiError = {
        error: 'Invalid values',
        message: 'Sprint duration and default velocity must be greater than 0'
      };
      return res.status(400).json(apiError);
    }

    // Delete existing config and create new one (only keep latest)
    await prisma.sprintConfig.deleteMany({});

    const config = await prisma.sprintConfig.create({
      data: {
        firstSprintStartDate: new Date(firstSprintStartDate),
        sprintDurationDays,
        defaultVelocity
      }
    });

    const response: ApiResponse<typeof config> = {
      data: config,
      message: 'Sprint configuration saved successfully'
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Error saving sprint config:', error);
    const apiError: ApiError = {
      error: 'Failed to save sprint config',
      message: error instanceof Error ? error.message : 'Unknown error'
    };
    res.status(500).json(apiError);
  }
});

export default router; 