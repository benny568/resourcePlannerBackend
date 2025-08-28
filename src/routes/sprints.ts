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

// Track active regeneration operations to prevent race conditions  
let regenerationInProgress = false;
let lastRegenerationTime = 0;
const REGENERATION_COOLDOWN = 5000; // 5 second cooldown between regenerations

// POST /api/sprints/batch - Batch update/create sprints
router.post('/batch', async (req, res) => {
  const { sprints, isRegeneration }: { sprints: SprintData[], isRegeneration?: boolean } = req.body;

  // Prevent multiple regeneration operations running simultaneously or too quickly
  if (isRegeneration) {
    const now = Date.now();
    
    if (regenerationInProgress) {
      console.warn('⚠️ Regeneration already in progress, rejecting duplicate request');
      const apiError: ApiError = {
        error: 'Regeneration already in progress',
        message: 'Another sprint regeneration is currently running. Please wait for it to complete.'
      };
      return res.status(409).json(apiError);
    }
    
    if (now - lastRegenerationTime < REGENERATION_COOLDOWN) {
      const remainingCooldown = Math.ceil((REGENERATION_COOLDOWN - (now - lastRegenerationTime)) / 1000);
      console.warn(`⚠️ Regeneration cooldown active, rejecting request. ${remainingCooldown}s remaining`);
      const apiError: ApiError = {
        error: 'Regeneration cooldown active',
        message: `Please wait ${remainingCooldown} seconds before regenerating sprints again.`
      };
      return res.status(429).json(apiError);
    }
    
    lastRegenerationTime = now;
  }
  
  try {
    // Set regeneration lock
    if (isRegeneration) {
      regenerationInProgress = true;
      console.log('🔒 Starting regeneration process...');
    }

    if (!Array.isArray(sprints) || sprints.length === 0) {
      const apiError: ApiError = {
        error: 'Invalid input',
        message: 'sprints must be a non-empty array'
      };
      return res.status(400).json(apiError);
    }

    console.log(`📡 Batch sprint operation: processing ${sprints.length} sprints (regeneration: ${isRegeneration})`);

    // Use transaction to ensure all operations succeed or fail together
    const results = await prisma.$transaction(async (tx) => {
      // If this is a regeneration operation, clear ALL existing non-archived sprints
      if (isRegeneration) {
        console.log(`🗑️ REGENERATION: Clearing ALL existing sprints`);
        
        const deletedResult = await tx.sprint.deleteMany({
          where: {
            archived: false
          }
        });
        
        console.log(`✅ Deleted ${deletedResult.count} existing sprints during regeneration`);
      }

      const updatedSprints = [];

      for (const sprintData of sprints) {
        const { name, startDate, endDate, plannedVelocity, actualVelocity } = sprintData;

        if (!name || !startDate || !endDate || !plannedVelocity) {
          throw new Error(`Missing required fields for sprint: ${name || 'unnamed'}`);
        }

        // For regeneration, always create new sprints since we cleared existing ones
        if (isRegeneration) {
          // Extra safety: Check if sprint with this name already exists to prevent duplicates
          const existingDuplicate = await tx.sprint.findFirst({
            where: { name, archived: false }
          });
          
          if (existingDuplicate) {
            console.warn(`⚠️ DUPLICATE PREVENTION: Sprint "${name}" already exists, skipping creation`);
            updatedSprints.push(existingDuplicate);
          } else {
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
        } else {
          // For non-regeneration operations, check for existing sprints by name first (exact match)
          let existingSprint = await tx.sprint.findFirst({
            where: {
              name,
              archived: false
            }
          });

          // If no exact name match, check by name + dates for precision
          if (!existingSprint) {
            existingSprint = await tx.sprint.findFirst({
              where: {
                name,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                archived: false
              }
            });
          }

          // If still no match, check for potential duplicates with similar names
          if (!existingSprint) {
            const similarSprints = await tx.sprint.findMany({
              where: {
                name: {
                  contains: name
                },
                archived: false
              }
            });

            if (similarSprints.length > 0) {
              console.warn(`⚠️ Found ${similarSprints.length} similar sprints for "${name}":`, 
                similarSprints.map(s => `${s.name} (ID: ${s.id})`));
              // Use exact match if available, otherwise skip to prevent duplicates
              existingSprint = similarSprints.find(s => s.name === name) || null;
              if (!existingSprint && similarSprints.length > 0) {
                console.log(`🚫 Skipping creation of "${name}" to prevent duplicates. Use exact names or archive duplicates first.`);
                continue; // Skip this sprint to prevent duplicates
              }
            }
          }

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
          } else {
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

    const response: ApiResponse<typeof results> = {
      data: results,
      message: `Batch operation completed: ${results.length} sprints processed`
    };

    res.json(response);
  } catch (error) {
    console.error('Error in batch sprint operation:', error);
    const apiError: ApiError = {
      error: 'Failed to process batch sprint operation',
      message: error instanceof Error ? error.message : 'Unknown error'
    };
    res.status(500).json(apiError);
  } finally {
    // Always release regeneration lock
    if (isRegeneration) {
      regenerationInProgress = false;
      console.log('🔓 Regeneration lock released');
    }
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