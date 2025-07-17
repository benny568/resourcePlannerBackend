import express from 'express';
import { prisma } from '../lib/prisma';
import { WorkItemData, ApiResponse, ApiError, WorkItemResponse } from '../types';

const router = express.Router();

// GET /api/work-items - Get all work items with dependencies and sprint assignments
router.get('/', async (req, res) => {
  try {
    const workItems = await prisma.workItem.findMany({
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

    const response: ApiResponse<typeof transformedWorkItems> = {
      data: transformedWorkItems
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching work items:', error);
    const apiError: ApiError = {
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
    
    const workItem = await prisma.workItem.findUnique({
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
      const apiError: ApiError = {
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

    const response: ApiResponse<typeof transformedWorkItem> = {
      data: transformedWorkItem
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching work item:', error);
    const apiError: ApiError = {
      error: 'Failed to fetch work item',
      message: error instanceof Error ? error.message : 'Unknown error'
    };
    res.status(500).json(apiError);
  }
});

// POST /api/work-items - Create a new work item
router.post('/', async (req, res) => {
  try {
    const { 
      title, 
      description, 
      estimateStoryPoints, 
      requiredCompletionDate, 
      requiredSkills, 
      dependencies = [],
      status = 'Not Started'
    }: WorkItemData = req.body;

    if (!title || !estimateStoryPoints || !requiredCompletionDate || !requiredSkills) {
      const apiError: ApiError = {
        error: 'Missing required fields',
        message: 'title, estimateStoryPoints, requiredCompletionDate, and requiredSkills are required'
      };
      return res.status(400).json(apiError);
    }

    if (estimateStoryPoints <= 0) {
      const apiError: ApiError = {
        error: 'Invalid story points',
        message: 'Story points must be greater than 0'
      };
      return res.status(400).json(apiError);
    }

    // Validate dependencies exist
    if (dependencies.length > 0) {
      const existingDependencies = await prisma.workItem.findMany({
        where: {
          id: { in: dependencies }
        }
      });

      if (existingDependencies.length !== dependencies.length) {
        const apiError: ApiError = {
          error: 'Invalid dependencies',
          message: 'Some dependency work items do not exist'
        };
        return res.status(400).json(apiError);
      }
    }

    // Create work item and dependencies in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const workItem = await tx.workItem.create({
        data: {
          title,
          description,
          estimateStoryPoints,
          requiredCompletionDate: new Date(requiredCompletionDate),
          requiredSkills,
          status
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

    const response: ApiResponse<WorkItemResponse> = {
      data: { ...result, dependencies, assignedSprints: [] },
      message: 'Work item created successfully'
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Error creating work item:', error);
    const apiError: ApiError = {
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
    const { 
      title, 
      description, 
      estimateStoryPoints, 
      requiredCompletionDate, 
      requiredSkills, 
      dependencies,
      status
    }: Partial<WorkItemData> = req.body;

    // Check if work item exists
    const existingWorkItem = await prisma.workItem.findUnique({
      where: { id }
    });

    if (!existingWorkItem) {
      const apiError: ApiError = {
        error: 'Work item not found'
      };
      return res.status(404).json(apiError);
    }

    // Validate story points if provided
    if (estimateStoryPoints !== undefined && estimateStoryPoints <= 0) {
      const apiError: ApiError = {
        error: 'Invalid story points',
        message: 'Story points must be greater than 0'
      };
      return res.status(400).json(apiError);
    }

    // Validate dependencies if provided
    if (dependencies) {
      // Prevent self-dependency
      if (dependencies.includes(id)) {
        const apiError: ApiError = {
          error: 'Invalid dependencies',
          message: 'Work item cannot depend on itself'
        };
        return res.status(400).json(apiError);
      }

      const existingDependencies = await prisma.workItem.findMany({
        where: {
          id: { in: dependencies }
        }
      });

      if (existingDependencies.length !== dependencies.length) {
        const apiError: ApiError = {
          error: 'Invalid dependencies',
          message: 'Some dependency work items do not exist'
        };
        return res.status(400).json(apiError);
      }
    }

    // Update work item and dependencies in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const workItem = await tx.workItem.update({
        where: { id },
        data: {
          ...(title && { title }),
          ...(description !== undefined && { description }),
          ...(estimateStoryPoints !== undefined && { estimateStoryPoints }),
          ...(requiredCompletionDate && { requiredCompletionDate: new Date(requiredCompletionDate) }),
          ...(requiredSkills && { requiredSkills }),
          ...(status && { status })
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

    const response: ApiResponse<WorkItemResponse> = {
      data: { ...result, dependencies: dependencies || [], assignedSprints: [] },
      message: 'Work item updated successfully'
    };

    res.json(response);
  } catch (error) {
    console.error('Error updating work item:', error);
    const apiError: ApiError = {
      error: 'Failed to update work item',
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
    const existingWorkItem = await prisma.workItem.findUnique({
      where: { id }
    });

    if (!existingWorkItem) {
      const apiError: ApiError = {
        error: 'Work item not found'
      };
      return res.status(404).json(apiError);
    }

    await prisma.workItem.delete({
      where: { id }
    });

    const response: ApiResponse<{ id: string }> = {
      data: { id },
      message: 'Work item deleted successfully'
    };

    res.json(response);
  } catch (error) {
    console.error('Error deleting work item:', error);
    const apiError: ApiError = {
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
      const apiError: ApiError = {
        error: 'Missing sprint ID',
        message: 'sprintId is required'
      };
      return res.status(400).json(apiError);
    }

    // Check if work item and sprint exist
    const [workItem, sprint] = await Promise.all([
      prisma.workItem.findUnique({ where: { id } }),
      prisma.sprint.findUnique({ where: { id: sprintId } })
    ]);

    if (!workItem) {
      const apiError: ApiError = {
        error: 'Work item not found'
      };
      return res.status(404).json(apiError);
    }

    if (!sprint) {
      const apiError: ApiError = {
        error: 'Sprint not found'
      };
      return res.status(404).json(apiError);
    }

    // Check if already assigned
    const existingAssignment = await prisma.sprintWorkItem.findUnique({
      where: {
        sprintId_workItemId: {
          sprintId,
          workItemId: id
        }
      }
    });

    if (existingAssignment) {
      const apiError: ApiError = {
        error: 'Work item already assigned to this sprint'
      };
      return res.status(400).json(apiError);
    }

    const assignment = await prisma.sprintWorkItem.create({
      data: {
        sprintId,
        workItemId: id
      }
    });

    const response: ApiResponse<typeof assignment> = {
      data: assignment,
      message: 'Work item assigned to sprint successfully'
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Error assigning work item to sprint:', error);
    const apiError: ApiError = {
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

    const existingAssignment = await prisma.sprintWorkItem.findUnique({
      where: {
        sprintId_workItemId: {
          sprintId,
          workItemId: id
        }
      }
    });

    if (!existingAssignment) {
      const apiError: ApiError = {
        error: 'Assignment not found'
      };
      return res.status(404).json(apiError);
    }

    await prisma.sprintWorkItem.delete({
      where: {
        sprintId_workItemId: {
          sprintId,
          workItemId: id
        }
      }
    });

    const response: ApiResponse<{ workItemId: string; sprintId: string }> = {
      data: { workItemId: id, sprintId },
      message: 'Work item removed from sprint successfully'
    };

    res.json(response);
  } catch (error) {
    console.error('Error removing work item from sprint:', error);
    const apiError: ApiError = {
      error: 'Failed to remove work item from sprint',
      message: error instanceof Error ? error.message : 'Unknown error'
    };
    res.status(500).json(apiError);
  }
});

export default router; 