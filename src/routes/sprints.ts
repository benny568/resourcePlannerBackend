import express from 'express';
import { prisma } from '../lib/prisma';
import { SprintData, ApiResponse, ApiError, SprintResponse } from '../types';

const router = express.Router();

// GET /api/sprints - Get all sprints with work items (excluding archived)
router.get('/', async (req, res) => {
  try {
    const sprints = await prisma.sprint.findMany({
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

    const response: ApiResponse<typeof transformedSprints> = {
      data: transformedSprints
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching sprints:', error);
    const apiError: ApiError = {
      error: 'Failed to fetch sprints',
      message: error instanceof Error ? error.message : 'Unknown error'
    };
    res.status(500).json(apiError);
  }
});

// POST /api/sprints - Create a new sprint
router.post('/', async (req, res) => {
  try {
    const { name, startDate, endDate, plannedVelocity, actualVelocity }: SprintData = req.body;

    if (!name || !startDate || !endDate || !plannedVelocity) {
      const apiError: ApiError = {
        error: 'Missing required fields',
        message: 'name, startDate, endDate, and plannedVelocity are required'
      };
      return res.status(400).json(apiError);
    }

    const sprint = await prisma.sprint.create({
      data: {
        name,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        plannedVelocity,
        ...(actualVelocity !== undefined && { actualVelocity })
      }
    });

    const response: ApiResponse<SprintResponse> = {
      data: { ...sprint, workItems: [] },
      message: 'Sprint created successfully'
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Error creating sprint:', error);
    const apiError: ApiError = {
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
    const { name, startDate, endDate, plannedVelocity, actualVelocity }: Partial<SprintData> = req.body;

    const existingSprint = await prisma.sprint.findUnique({
      where: { id }
    });

    if (!existingSprint) {
      const apiError: ApiError = {
        error: 'Sprint not found'
      };
      return res.status(404).json(apiError);
    }

    const sprint = await prisma.sprint.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(startDate && { startDate: new Date(startDate) }),
        ...(endDate && { endDate: new Date(endDate) }),
        ...(plannedVelocity !== undefined && { plannedVelocity }),
        ...(actualVelocity !== undefined && { actualVelocity })
      }
    });

    const response: ApiResponse<typeof sprint> = {
      data: sprint,
      message: 'Sprint updated successfully'
    };

    res.json(response);
  } catch (error) {
    console.error('Error updating sprint:', error);
    const apiError: ApiError = {
      error: 'Failed to update sprint',
      message: error instanceof Error ? error.message : 'Unknown error'
    };
    res.status(500).json(apiError);
  }
});

// DELETE /api/sprints/:id - Archive a sprint (mark as archived instead of deleting)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const existingSprint = await prisma.sprint.findUnique({
      where: { id }
    });

    if (!existingSprint) {
      const apiError: ApiError = {
        error: 'Sprint not found'
      };
      return res.status(404).json(apiError);
    }

    const sprint = await prisma.sprint.update({
      where: { id },
      data: {
        archived: true
      }
    });

    const response: ApiResponse<typeof sprint> = {
      data: sprint,
      message: 'Sprint archived successfully'
    };

    res.json(response);
  } catch (error) {
    console.error('Error archiving sprint:', error);
    const apiError: ApiError = {
      error: 'Failed to archive sprint',
      message: error instanceof Error ? error.message : 'Unknown error'
    };
    res.status(500).json(apiError);
  }
});

export default router; 