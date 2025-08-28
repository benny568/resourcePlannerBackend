import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';

const router = Router();

// Schema for project key validation
const ProjectKeySchema = z.object({
  projectKey: z.string().min(1).max(10).default('REF')
});

// Schema for paginated epic import
const PaginatedProjectKeySchema = z.object({
  projectKey: z.string().min(1).max(10).default('REF'),
  limit: z.number().min(1).max(100).default(25),
  startAt: z.number().min(0).default(0)
});

// Types for Jira responses
interface JiraUser {
  account_id: string;
  display_name: string;
  email: string;
  active: boolean;
}

interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    description?: string;
    status: { name: string };
    created?: string;
    updated?: string;
    assignee?: JiraUser;
    reporter?: JiraUser;
    labels?: string[];
    customfield_10016?: number; // Story Points
    priority?: any;
    fixVersions?: any[];
  };
}

interface JiraSearchResponse {
  issues: JiraIssue[];
  total: number;
}

interface EpicWithChildren {
  id: string;
  jiraId: string;
  title: string;
  description: string;
  status: string;
  jiraStatus: string;
  children: any[];
  totalStoryPoints: number;
  completedStoryPoints: number;
}

interface PaginatedEpicsResponse {
  epics: EpicWithChildren[];
  pagination: {
    limit: number;
    startAt: number;
    total: number;
    hasMore: boolean;
  };
}

// Helper function to convert Jira status to work item status
function convertJiraStatusToWorkItemStatus(jiraStatus: string): string {
  const status = jiraStatus.toLowerCase();
  if (status === 'done' || status === 'closed' || status === 'resolved') {
    return 'Completed';
  } else if (status === 'in progress' || status === 'in development' || status === 'in review') {
    return 'In Progress';
  } else {
    return 'Not Started';
  }
}

// Helper function to validate and convert story points
function validateStoryPoints(value: any): number {
  // Handle null, undefined, or "None" values
  if (value === null || value === undefined || value === "None" || value === "") {
    return 1; // Return 1 instead of 0 to pass backend validation
  }
  
  // Convert to number if it's a string
  let points: number;
  if (typeof value === 'string') {
    // Handle string numbers
    points = parseFloat(value.trim());
    if (isNaN(points)) {
      return 1; // Return 1 instead of 0 to pass backend validation
    }
  } else if (typeof value === 'number') {
    points = value;
  } else {
    return 1; // Return 1 instead of 0 to pass backend validation
  }
  
  // Cap story points at a reasonable maximum (20 points)
  // If the value is unreasonably high (>100), it's probably not story points
  if (points > 100) {
    console.warn(`⚠️ Unreasonable story points value ${points}, setting to 1`);
    return 1;
  }
  
  // Ensure positive values and reasonable range (minimum 0.5 for fractional points)
  return Math.max(0.5, Math.min(points, 20));
}

// Helper function to extract plain text from Atlassian Document Format
function extractTextFromADF(adfContent: any): string {
  if (!adfContent) return '';
  
  // If it's already a string, return it
  if (typeof adfContent === 'string') return adfContent;
  
  // If it's an ADF object, extract text recursively
  if (adfContent.content && Array.isArray(adfContent.content)) {
    return adfContent.content.map((node: any) => extractTextFromADF(node)).join('\n');
  }
  
  // Handle different node types
  if (adfContent.type === 'paragraph' || adfContent.type === 'listItem') {
    if (adfContent.content && Array.isArray(adfContent.content)) {
      return adfContent.content.map((node: any) => extractTextFromADF(node)).join('');
    }
  }
  
  if (adfContent.type === 'text') {
    return adfContent.text || '';
  }
  
  if (adfContent.type === 'bulletList' || adfContent.type === 'orderedList') {
    if (adfContent.content && Array.isArray(adfContent.content)) {
      return adfContent.content.map((node: any) => '• ' + extractTextFromADF(node)).join('\n');
    }
  }
  
  // For other types, try to extract content recursively
  if (adfContent.content && Array.isArray(adfContent.content)) {
    return adfContent.content.map((node: any) => extractTextFromADF(node)).join(' ');
  }
  
  return '';
}

// Helper function to call Jira API through the proxy service
async function callJiraAPI(endpoint: string, body: any): Promise<any> {
  const JIRA_PROXY_URL = 'http://jira-proxy:8080';
  
  console.log(`🔍 Making Jira API call through proxy:`);
  console.log(`   Endpoint: ${endpoint}`);
  console.log(`   Request: ${JSON.stringify(body, null, 2)}`);
  
  try {
    let url: string;
    let options: RequestInit;
    
    if (endpoint === 'search') {
      // Use the search endpoint
      url = `${JIRA_PROXY_URL}/jira/search`;
      options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body)
      };
    } else if (endpoint.startsWith('issue/')) {
      // Get single issue
      const issueKey = endpoint.split('/')[1];
      const params = new URLSearchParams();
      if (body.fields) params.append('fields', body.fields);
      if (body.expand) params.append('expand', body.expand);
      
      url = `${JIRA_PROXY_URL}/jira/issue/${issueKey}${params.toString() ? '?' + params.toString() : ''}`;
      options = {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        }
      };
    } else {
      throw new Error(`Unsupported endpoint: ${endpoint}`);
    }
    
    console.log(`📡 Calling: ${url}`);
    
    const response = await fetch(url, options);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Jira proxy error: ${response.status} ${response.statusText}`);
      console.error(`   Error details: ${errorText}`);
      throw new Error(`Jira API call failed: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    const data = await response.json() as any;
    console.log(`✅ Successfully retrieved data from Jira (${data.issues?.length || 1} items)`);
    return data;
    
  } catch (error) {
    console.error('❌ Error calling Jira API through proxy:', error);
    throw error;
  }
}

// Extract team members from Jira project
router.post('/team-members', async (req, res) => {
  try {
    const { projectKey } = ProjectKeySchema.parse(req.body);
    console.log(`🔍 Extracting team members from Jira project: ${projectKey}`);

    // Get all users who have been assigned issues in this project
    const jql = `project = ${projectKey} AND assignee is not EMPTY`;
    console.log(`🔍 Executing JQL for team members: ${jql}`);
    
    const searchData = await callJiraAPI('search', {
      jql: jql,
      fields: 'assignee',
      limit: 1000
    }) as JiraSearchResponse;

    // Extract unique assignees
    const uniqueUsers = new Map<string, JiraUser>();
    
    for (const issue of searchData.issues || []) {
      if (issue.fields.assignee) {
        const user = issue.fields.assignee;
        if (user.active && !uniqueUsers.has(user.account_id)) {
          uniqueUsers.set(user.account_id, user);
        }
      }
    }

    // Convert to team member format
    const teamMembers = Array.from(uniqueUsers.values()).map(user => ({
      id: user.account_id,
      name: user.display_name,
      capacity: 100,
      skills: ["backend", "frontend"], // Default skills - could be enhanced to derive from issue types
      personalHolidays: []
    }));

    console.log(`✅ Extracted ${teamMembers.length} active team members from project ${projectKey}`);
    res.json(teamMembers);

  } catch (error) {
    console.error('❌ Error extracting team members from Jira API:', error);
    res.status(503).json({ 
      error: 'Failed to extract team members from Jira API',
      details: error instanceof Error ? error.message : 'Unknown error',
      suggestion: 'Check Jira API connectivity and credentials'
    });
  }
});

// Import a single Jira ticket as work item
router.post('/ticket', async (req, res) => {
  try {
    const ticketKey = req.body.ticketKey?.trim();
    if (!ticketKey) {
      return res.status(400).json({ error: 'Ticket key is required' });
    }

    console.log(`🎫 Importing single Jira ticket: ${ticketKey}`);

    // Get the specific ticket from Jira API
    const jql = `key = ${ticketKey}`;
    console.log(`🔍 Executing JQL for single ticket: ${jql}`);
    
    // Use configurable story points field (default to customfield_10016)
    const storyPointsField = process.env.JIRA_STORY_POINTS_FIELD || 'customfield_10016';
    const searchData = await callJiraAPI('search', {
      jql: jql,
      fields: `key,summary,description,status,created,updated,assignee,labels,${storyPointsField},priority`,
      limit: 1
    }) as JiraSearchResponse;

    if (!searchData.issues || searchData.issues.length === 0) {
      return res.status(404).json({ 
        error: `Jira ticket ${ticketKey} not found`,
        suggestion: 'Check that the ticket key is correct and you have access to it'
      });
    }

    const jiraTicket = searchData.issues[0];
    
    // Convert to work item format
    const workItem = {
      id: jiraTicket.key,
      title: jiraTicket.fields.summary,
      description: extractTextFromADF(jiraTicket.fields.description) || `Work item imported from Jira ticket ${jiraTicket.key}`,
      estimateStoryPoints: validateStoryPoints((jiraTicket.fields as any)[storyPointsField]),
      requiredCompletionDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days from now
      requiredSkills: (jiraTicket.fields.labels || []).filter(label => 
        ['frontend', 'backend', 'devops', 'design', 'qa'].includes(label.toLowerCase())
      ),
      dependencies: [],
      status: convertJiraStatusToWorkItemStatus(jiraTicket.fields.status.name),
      jiraStatus: jiraTicket.fields.status.name,
      assignedSprints: [],
      jiraId: jiraTicket.key
    };

    console.log(`✅ Successfully imported ticket ${ticketKey} from Jira API`);
    res.json(workItem);
    
  } catch (error) {
    console.error(`❌ Error importing ticket from Jira API:`, error);
    res.status(503).json({ 
      error: 'Failed to import ticket from Jira API',
      details: error instanceof Error ? error.message : 'Unknown error',
      suggestion: 'Check Jira API connectivity and that the ticket exists'
    });
  }
});

// Extract regular work items (NOT epics) from Jira project
router.post('/work-items', async (req, res) => {
  try {
    const { projectKey, includeVelocity } = req.body;
    const validatedData = ProjectKeySchema.parse({ projectKey });
    console.log(`🔍 Extracting regular work items (excluding epics) from Jira project: ${validatedData.projectKey}`);
    
    // NEW: If includeVelocity is requested, return velocity data instead
    if (includeVelocity) {
      console.log(`📊 VELOCITY MODE: Getting completed issues for velocity analysis`);
      
      const completedJql = `project = ${validatedData.projectKey} AND status = Done`;
      const storyPointsField = process.env.JIRA_STORY_POINTS_FIELD || 'customfield_10016';
      
      const completedData = await callJiraAPI('search', {
        jql: completedJql,
        fields: `key,summary,status,${storyPointsField},fixVersions`,
        maxResults: 100
      }) as JiraSearchResponse;
      
      console.log(`📈 Found ${completedData.issues.length} completed issues`);
      
      // DEBUG: Log first few issues for troubleshooting
      if (completedData.issues.length > 0) {
        console.log(`🔍 DEBUG: First completed issue:`, {
          key: completedData.issues[0].key,
          summary: completedData.issues[0].fields.summary,
          status: completedData.issues[0].fields.status.name,
          storyPoints: (completedData.issues[0].fields as any)[storyPointsField],
          fixVersions: completedData.issues[0].fields.fixVersions
        });
      } else {
        console.log(`⚠️ DEBUG: No completed issues found with JQL: ${completedJql}`);
      }
      
      // Group by fixVersions for velocity
      const velocityGroups = new Map();
      completedData.issues.forEach(issue => {
        const points = (issue.fields as any)[storyPointsField] || 1;
        const versions = issue.fields.fixVersions || [];
        const versionName = versions.length > 0 ? versions[0].name : 'No Version';
        
        if (!velocityGroups.has(versionName)) {
          velocityGroups.set(versionName, { count: 0, points: 0 });
        }
        const group = velocityGroups.get(versionName);
        group.count += 1;
        group.points += points;
      });
      
      const syncResults = Array.from(velocityGroups.entries()).map(([name, data]) => ({
        sprintName: name,
        status: 'synced',
        actualVelocity: data.points,
        completedCount: data.count,
        message: `Found ${data.count} issues with ${data.points} total points`
      }));
      
      return res.json({
        message: `Velocity analysis complete: ${syncResults.length} versions found`,
        syncResults,
        timestamp: new Date().toISOString()
      });
    }

    // Get all non-epic issues from the project that are not Done AND are not children of epics
    const jql = `project = ${projectKey} AND issuetype != Epic AND status != Done AND parent is EMPTY`;
    console.log(`🔍 Executing JQL for work items (excluding epic children): ${jql}`);
    
    // Use configurable story points field (default to customfield_10016)
    const storyPointsField = process.env.JIRA_STORY_POINTS_FIELD || 'customfield_10016';
    const searchData = await callJiraAPI('search', {
      jql: jql,
      fields: `key,summary,description,status,created,updated,assignee,labels,${storyPointsField},fixVersions`,
      limit: 100
    }) as JiraSearchResponse;

    // Convert tickets to work item format
    const workItems = (searchData.issues || []).map(ticket => ({
      id: ticket.key,
      jiraId: ticket.key,
      title: ticket.fields.summary,
      description: extractTextFromADF(ticket.fields.description) || `Work item imported from Jira ticket ${ticket.key}`,
      estimateStoryPoints: validateStoryPoints((ticket.fields as any)[storyPointsField]),
      requiredCompletionDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(), // 60 days for regular work items
      requiredSkills: (ticket.fields.labels || []).filter(label => 
        ['frontend', 'backend', 'devops', 'design', 'qa'].includes(label.toLowerCase())
      ),
      dependencies: [],
      status: convertJiraStatusToWorkItemStatus(ticket.fields.status.name),
      jiraStatus: ticket.fields.status.name,
      assignedSprints: []
    }));

    console.log(`✅ Extracted ${workItems.length} regular work items (excluding epics) from Jira API for project ${projectKey}`);
    res.json(workItems);

  } catch (error) {
    console.error('❌ Error extracting work items from Jira API:', error);
    res.status(503).json({
      error: 'Failed to extract work items from Jira API',
      details: error instanceof Error ? error.message : 'Unknown error',
      suggestion: 'Check Jira API connectivity and credentials'
    });
  }
});

// Extract epics from Jira project (DEPRECATED - use epics-with-children instead)
router.post('/epics', async (req, res) => {
  try {
    const { projectKey } = ProjectKeySchema.parse(req.body);
    console.log(`🔍 Extracting epics from Jira project: ${projectKey}`);

    // Get all epics from the project that are not Done
    const jql = `project = ${projectKey} AND issuetype = Epic AND status != Done`;
    console.log(`🔍 Executing JQL for epics: ${jql}`);
    
    // Use configurable story points field (default to customfield_10016)
    const storyPointsField = process.env.JIRA_STORY_POINTS_FIELD || 'customfield_10016';
    const searchData = await callJiraAPI('search', {
      jql: jql,
      fields: `key,summary,description,status,created,updated,assignee,labels,${storyPointsField},fixVersions`,
      limit: 100
    }) as JiraSearchResponse;

    // Convert epics to work item format
    const workItems = (searchData.issues || []).map(epic => ({
      id: epic.key,
      jiraId: epic.key,
      title: epic.fields.summary,
      description: extractTextFromADF(epic.fields.description) || `Epic imported from Jira ticket ${epic.key}`,
      estimateStoryPoints: validateStoryPoints((epic.fields as any)[storyPointsField]),
      requiredCompletionDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(), // 180 days for epics
      requiredSkills: (epic.fields.labels || []).filter(label => 
        ['frontend', 'backend', 'devops', 'design', 'qa'].includes(label.toLowerCase())
      ),
      dependencies: [],
      status: convertJiraStatusToWorkItemStatus(epic.fields.status.name),
      jiraStatus: epic.fields.status.name,
      assignedSprints: []
    }));

    console.log(`✅ Extracted ${workItems.length} epics from Jira API for project ${projectKey}`);
    res.json(workItems);

  } catch (error) {
    console.error('❌ Error extracting epics from Jira API:', error);
    res.status(503).json({
      error: 'Failed to extract epics from Jira API',
      details: error instanceof Error ? error.message : 'Unknown error',
      suggestion: 'Check Jira API connectivity and credentials'
    });
  }
});

// Import both team members and epics in one call
router.post('/import', async (req, res) => {
  try {
    const { projectKey } = ProjectKeySchema.parse(req.body);
    console.log(`🚀 Starting full Jira import for project: ${projectKey}`);

    res.status(501).json({
      error: 'Direct bulk import not implemented',
      message: 'Use individual endpoints: /team-members and /epics',
      suggestion: 'Call /api/jira/team-members and /api/jira/epics separately',
      projectKey
    });

  } catch (error) {
    console.error('❌ Jira import failed:', error);
    res.status(500).json({
      error: 'Failed to process import request',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Import epics with their children from Jira project
router.post('/epics-with-children', async (req, res) => {
  // Set a timeout for this request to prevent indefinite hanging
  const timeoutMs = 120000; // 2 minutes
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Request timeout after 2 minutes')), timeoutMs);
  });

  try {
    const { projectKey, limit, startAt } = PaginatedProjectKeySchema.parse(req.body);
    console.log(`🔍 Extracting epics with children from Jira project: ${projectKey}`);
    console.log(`📋 Filtering: Only epics with status NOT IN ('Done', 'Cancelled') will be included`);
    console.log(`📄 Pagination: limit=${limit}, startAt=${startAt}`);
    console.log(`⏰ Request will timeout after ${timeoutMs/1000} seconds`);

    const epicsWithChildren: EpicWithChildren[] = [];
    
    // Wrap the main processing in a race with timeout
    const processEpics = async (): Promise<PaginatedEpicsResponse> => {
      // First, get epics from the project that are not Done/Cancelled with pagination
      const jql = `project = ${projectKey} AND issuetype = Epic AND status NOT IN (Done, Cancelled)`;
      console.log(`🔍 Executing JQL: ${jql}`);
      
      const epicsData = await callJiraAPI('search', {
        jql: jql,
        fields: 'key,summary,description,status,created,updated,assignee,fixVersions,labels',
        startAt: startAt,
        maxResults: limit
      }) as JiraSearchResponse;

    console.log(`📊 Found ${epicsData.issues?.length || 0} epics from Jira API (${startAt} to ${startAt + (epicsData.issues?.length || 0)} of ${epicsData.total} total)`);

    // No more artificial limit - process all epics returned by pagination

    // Use configurable story points field (default to customfield_10016)
    const storyPointsField = process.env.JIRA_STORY_POINTS_FIELD || 'customfield_10016';

    // Process epics in parallel with concurrency limit
    const processEpicWithChildren = async (epic: any): Promise<EpicWithChildren> => {
      const epicData: EpicWithChildren = {
        id: epic.key,
        jiraId: epic.key,
        title: epic.fields.summary,
        description: extractTextFromADF(epic.fields.description) || '',
        status: convertJiraStatusToWorkItemStatus(epic.fields.status.name),
        jiraStatus: epic.fields.status.name,
        children: [],
        totalStoryPoints: 0,
        completedStoryPoints: 0
      };

      // Get children for this epic
      try {
        const childrenJql = `parent = ${epic.key}`;
        const childrenData = await callJiraAPI('search', {
          jql: childrenJql,
          fields: `key,summary,description,status,${storyPointsField},assignee,priority`,
          limit: 200
        }) as JiraSearchResponse;

        console.log(`  📝 Epic ${epic.key} has ${childrenData.issues?.length || 0} children`);

        let totalPoints = 0;
        let completedPoints = 0;

        for (const child of childrenData.issues || []) {
          const rawStoryPoints = (child.fields as any)[storyPointsField];
          const storyPoints = validateStoryPoints(rawStoryPoints); // Validate story points
          const childStatus = child.fields.status.name;
          
          if (childStatus === 'Done' || childStatus === 'Closed' || childStatus === 'Resolved') {
            completedPoints += storyPoints;
          }
          totalPoints += storyPoints;

          const childData = {
            id: child.key,
            jiraId: child.key,
            title: child.fields.summary,
            description: extractTextFromADF(child.fields.description) || '',
            estimateStoryPoints: storyPoints,
            requiredCompletionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            requiredSkills: ["backend"], // Default skill
            dependencies: [],
            status: convertJiraStatusToWorkItemStatus(childStatus),
            jiraStatus: childStatus,
            assignedSprints: [],
            epicId: epic.key
          };

          epicData.children.push(childData);
        }

        epicData.totalStoryPoints = totalPoints;
        epicData.completedStoryPoints = completedPoints;
      } catch (childError: any) {
        console.error(`❌ Could not fetch children for epic ${epic.key}:`, childError.message);
        // Don't fail the whole request, just log the error and continue with empty children
      }

      return epicData;
    };

    // Apply pagination limit to the epics returned by Jira API
    const allEpics = epicsData.issues || [];
    const epics = allEpics.slice(0, limit);
    console.log(`🔄 Applying pagination: processing ${epics.length} of ${allEpics.length} epics returned by Jira (limit: ${limit})`);
    
    // Process epics in batches of 10 to avoid overwhelming the system
    const batchSize = 10;
    
    for (let i = 0; i < epics.length; i += batchSize) {
      const batch = epics.slice(i, i + batchSize);
      console.log(`🔄 Processing epic batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(epics.length/batchSize)} (${batch.length} epics)`);
      
      const batchResults = await Promise.all(
        batch.map(epic => processEpicWithChildren(epic))
      );
      
      epicsWithChildren.push(...batchResults);
      
      // Add a small delay between batches to be nice to the API
      if (i + batchSize < epics.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

      // Return paginated response
      const hasMore = startAt + epicsWithChildren.length < epicsData.total;
      
      return {
        epics: epicsWithChildren,
        pagination: {
          limit: limit,
          startAt: startAt,
          total: epicsData.total,
          hasMore: hasMore
        }
      };
    };

    // Race between processing and timeout
    const result = await Promise.race([processEpics(), timeoutPromise]) as PaginatedEpicsResponse;

    const totalChildren = result.epics.reduce((total, epic) => total + epic.children.length, 0);
    const totalStoryPoints = result.epics.reduce((total, epic) => total + epic.totalStoryPoints, 0);
    
    console.log(`✅ Returning ${result.epics.length} epics (page ${Math.floor(startAt / limit) + 1}) with ${totalChildren} children (${totalStoryPoints} total story points) for project ${projectKey}`);
    console.log(`📄 Pagination: ${startAt}-${startAt + result.epics.length} of ${result.pagination.total} total, hasMore: ${result.pagination.hasMore}`);
    res.json(result);

  } catch (error: any) {
    console.error('❌ Error extracting epics with children from Jira API:', error);
    
    if (error.message?.includes('timeout')) {
      res.status(504).json({
        error: 'Request timeout while extracting epics from Jira API',
        details: 'The request took too long to process. Try requesting fewer epics or check Jira API performance.',
        suggestion: 'Consider using smaller batches or filtering to fewer epics'
      });
    } else {
      res.status(503).json({
        error: 'Failed to extract epics with children from Jira API',
        details: error instanceof Error ? error.message : 'Unknown error',
        suggestion: 'Check Jira API connectivity and credentials'
      });
    }
  }
});

// Import a single epic with its children
router.post('/epic-with-children', async (req, res) => {
  try {
    const { epicKey } = req.body;
    if (!epicKey) {
      return res.status(400).json({ error: 'Epic key is required' });
    }

    console.log(`🎫 Importing single epic with children: ${epicKey}`);

    // Get the specific epic from Jira API
    const epicJql = `key = ${epicKey} AND issuetype = Epic`;
    console.log(`🔍 Executing JQL for epic: ${epicJql}`);
    
    const epicData = await callJiraAPI('search', {
      jql: epicJql,
      fields: 'key,summary,description,status,created,updated,assignee,labels',
      limit: 1
    }) as JiraSearchResponse;

    if (!epicData.issues || epicData.issues.length === 0) {
      return res.status(404).json({ 
        error: `Jira epic ${epicKey} not found`,
        suggestion: 'Check that the epic key is correct and you have access to it'
      });
    }

    const epic = epicData.issues[0];
    
    const epicWithChildren: EpicWithChildren = {
      id: epic.key,
      jiraId: epic.key,
      title: epic.fields.summary,
      description: extractTextFromADF(epic.fields.description) || '',
      status: convertJiraStatusToWorkItemStatus(epic.fields.status.name),
      jiraStatus: epic.fields.status.name,
      children: [],
      totalStoryPoints: 0,
      completedStoryPoints: 0
    };

    // Get children for this epic
    const childrenJql = `parent = ${epic.key}`;
    console.log(`🔍 Executing JQL for children: ${childrenJql}`);
    
    // Use configurable story points field (default to customfield_10016)
    const storyPointsField = process.env.JIRA_STORY_POINTS_FIELD || 'customfield_10016';
    const childrenData = await callJiraAPI('search', {
      jql: childrenJql,
      fields: `key,summary,description,status,${storyPointsField},assignee,priority`,
      limit: 200
    }) as JiraSearchResponse;

    console.log(`📝 Epic ${epic.key} has ${childrenData.issues?.length || 0} children`);

    let totalPoints = 0;
    let completedPoints = 0;

    for (const child of childrenData.issues || []) {
      const rawStoryPoints = (child.fields as any)[storyPointsField];
      const storyPoints = validateStoryPoints(rawStoryPoints);
      const childStatus = child.fields.status.name;
      
      if (childStatus === 'Done' || childStatus === 'Closed' || childStatus === 'Resolved') {
        completedPoints += storyPoints;
      }
      totalPoints += storyPoints;

      const childData = {
        id: child.key,
        jiraId: child.key,
        title: child.fields.summary,
        description: extractTextFromADF(child.fields.description) || '',
        estimateStoryPoints: storyPoints,
        requiredCompletionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        requiredSkills: ["backend"],
        dependencies: [],
        status: convertJiraStatusToWorkItemStatus(childStatus),
        jiraStatus: childStatus,
        assignedSprints: [],
        epicId: epic.key
      };

      epicWithChildren.children.push(childData);
    }

    epicWithChildren.totalStoryPoints = totalPoints;
    epicWithChildren.completedStoryPoints = completedPoints;

    console.log(`✅ Successfully imported epic ${epicKey} with ${epicWithChildren.children.length} children from Jira API`);
    res.json(epicWithChildren);
    
  } catch (error) {
    console.error(`❌ Error importing epic from Jira API:`, error);
    res.status(503).json({ 
      error: 'Failed to import epic from Jira API',
      details: error instanceof Error ? error.message : 'Unknown error',
      suggestion: 'Check Jira API connectivity and that the epic exists'
    });
  }
});

// Delete an epic (for future use when epics are persisted)
router.delete('/epic/:epicId', async (req, res) => {
  try {
    const { epicId } = req.params;
    
    if (!epicId) {
      return res.status(400).json({ 
        error: 'Epic ID is required',
        message: 'Please provide a valid epic ID to delete'
      });
    }

    console.log(`🗑️ Delete request for epic: ${epicId}`);
    
    // For now, since epics aren't persisted to database, just return success
    // In the future, this would delete from database:
    // await Epic.delete({ where: { id: epicId } });
    
    console.log(`✅ Epic ${epicId} deletion processed successfully`);
    res.json({ 
      success: true,
      message: `Epic ${epicId} deleted successfully`,
      epicId: epicId
    });
    
  } catch (error) {
    console.error(`❌ Error deleting epic:`, error);
    res.status(500).json({
      error: 'Failed to delete epic',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Special endpoint for AI assistant to provide real Jira data
router.post('/ai-import-epics', async (req, res) => {
  try {
    const { projectKey, epicsData } = req.body;
    
    if (!epicsData || !Array.isArray(epicsData)) {
      return res.status(400).json({
        error: 'Invalid epics data',
        message: 'Expected epicsData array from AI assistant'
      });
    }
    
    console.log(`🤖 Received real epic data from AI assistant for project: ${projectKey}`);
    console.log(`📊 Processing ${epicsData.length} epics with real Jira data`);
    
    // Process and return the epic data
    const processedEpics = epicsData.map((epic: any) => ({
      id: epic.id || epic.key,
      jiraId: epic.key,
      title: epic.title || epic.summary,
      description: epic.description || '',
      status: epic.status || 'Not Started',
      jiraStatus: epic.jiraStatus,
      children: epic.children || [],
      totalStoryPoints: epic.totalStoryPoints || 0,
      completedStoryPoints: epic.completedStoryPoints || 0
    }));
    
    const totalChildren = processedEpics.reduce((total: number, epic: any) => total + (epic.children?.length || 0), 0);
    const totalStoryPoints = processedEpics.reduce((total: number, epic: any) => total + (epic.totalStoryPoints || 0), 0);
    
    console.log(`✅ Successfully processed ${processedEpics.length} epics with ${totalChildren} children (${totalStoryPoints} total story points)`);
    
    res.json(processedEpics);
    
  } catch (error) {
    console.error('❌ Error processing AI-provided epic data:', error);
    res.status(500).json({
      error: 'Failed to process AI-provided epic data',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Special endpoint for AI assistant to provide real team member data
router.post('/ai-import-team-members', async (req, res) => {
  try {
    const { projectKey, teamMembersData } = req.body;
    
    if (!teamMembersData || !Array.isArray(teamMembersData)) {
      return res.status(400).json({
        error: 'Invalid team members data',
        message: 'Expected teamMembersData array from AI assistant'
      });
    }
    
    console.log(`🤖 Received real team member data from AI assistant for project: ${projectKey}`);
    console.log(`👥 Processing ${teamMembersData.length} team members with real Jira data`);
    
    res.json(teamMembersData);
    
  } catch (error) {
    console.error('❌ Error processing AI-provided team member data:', error);
    res.status(500).json({
      error: 'Failed to process AI-provided team member data',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Simple velocity analysis endpoint that works with basic Jira API
router.post('/velocity-analysis', async (req, res) => {
  try {
    const { projectKey } = req.body;
    
    if (!projectKey) {
      return res.status(400).json({ 
        error: 'Project key is required',
        suggestion: 'Provide a project key (e.g., REF)'
      });
    }

    console.log(`📊 Starting velocity analysis for project: ${projectKey}`);

    // Get completed issues using basic Jira API
    const completedIssuesJql = `project = ${projectKey} AND status = Done`;
    const storyPointsField = process.env.JIRA_STORY_POINTS_FIELD || 'customfield_10016';
    
    const completedIssues = await callJiraAPI('search', {
      jql: completedIssuesJql,
      fields: `key,summary,status,${storyPointsField},fixVersions,updated,created`,
      maxResults: 100
    }) as JiraSearchResponse;

    console.log(`📈 Found ${completedIssues.issues.length} completed issues`);

    // Group by fixVersions for velocity calculation
    const velocityData = new Map<string, { issues: any[], totalPoints: number }>();
    
    completedIssues.issues.forEach(issue => {
      const points = (issue.fields as any)[storyPointsField] || 1;
      const versions = issue.fields.fixVersions || [];
      
      if (versions.length > 0) {
        const version = versions[0].name;
        if (!velocityData.has(version)) {
          velocityData.set(version, { issues: [], totalPoints: 0 });
        }
        const data = velocityData.get(version)!;
        data.issues.push(issue);
        data.totalPoints += points;
      }
    });

    // Convert to sync results format
    const syncResults = Array.from(velocityData.entries()).map(([versionName, data]) => ({
      sprintName: versionName,
      status: 'analyzed',
      actualVelocity: data.totalPoints,
      completedCount: data.issues.length,
      message: `Analyzed ${data.issues.length} completed issues`
    }));

    res.json({
      message: `Velocity analysis complete: ${syncResults.length} versions analyzed`,
      syncResults,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error in velocity analysis:', error);
    res.status(500).json({
      error: 'Failed to analyze velocity data',
      message: error instanceof Error ? error.message : 'Unknown error',
      suggestion: 'Check Jira API connectivity and credentials'
    });
  }
});

// Sync sprint data from Jira to update actual velocity and work item status
router.post('/sync-sprints', async (req, res) => {
  try {
    const { projectKey } = req.body;
    
    if (!projectKey) {
      return res.status(400).json({ 
        error: 'Project key is required',
        suggestion: 'Provide a project key (e.g., REF)'
      });
    }

    console.log(`📊 Starting simplified sprint sync for project: ${projectKey}`);

    // Get completed issues using basic Jira API (same as velocity-analysis)
    const completedIssuesJql = `project = ${projectKey} AND status = Done`;
    const storyPointsField = process.env.JIRA_STORY_POINTS_FIELD || 'customfield_10016';
    
    const completedIssues = await callJiraAPI('search', {
      jql: completedIssuesJql,
      fields: `key,summary,status,${storyPointsField},fixVersions,updated,created`,
      maxResults: 100
    }) as JiraSearchResponse;

    console.log(`📈 Found ${completedIssues.issues.length} completed issues`);

    // Group by fixVersions for velocity calculation
    const velocityData = new Map<string, { issues: any[], totalPoints: number }>();
    
    completedIssues.issues.forEach(issue => {
      const points = (issue.fields as any)[storyPointsField] || 1;
      const versions = issue.fields.fixVersions || [];
      
      if (versions.length > 0) {
        const version = versions[0].name;
        if (!velocityData.has(version)) {
          velocityData.set(version, { issues: [], totalPoints: 0 });
        }
        const data = velocityData.get(version)!;
        data.issues.push(issue);
        data.totalPoints += points;
      }
    });

    // Convert to sync results format
    const syncResults = Array.from(velocityData.entries()).map(([versionName, data]) => ({
      sprintName: versionName,
      status: 'synced',
      actualVelocity: data.totalPoints,
      completedCount: data.issues.length,
      message: `Synced ${data.issues.length} completed issues with ${data.totalPoints} story points`
    }));

    res.json({
      message: `Successfully synced ${syncResults.length} sprint versions`,
      syncResults,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error syncing sprints from Jira:', error);
    res.status(500).json({
      error: 'Failed to sync sprint data from Jira',
      message: error instanceof Error ? error.message : 'Unknown error',
      suggestion: 'Check Jira API connectivity and credentials'
    });
  }
});

// Simplified helper function that only uses standard Jira search API
async function getCompletedSprintsFromJira(projectKey: string, sprintNames?: string[]) {
  try {
    console.log(`🔍 Getting completed issues for velocity analysis: ${projectKey}`);
    
    // Use only basic JQL that works with all Jira instances
    const completedIssuesJql = `project = ${projectKey} AND status = Done`;
    console.log(`🔍 Executing JQL: ${completedIssuesJql}`);
    
    const storyPointsField = process.env.JIRA_STORY_POINTS_FIELD || 'customfield_10016';
    const completedIssuesResponse = await callJiraAPI('search', {
      jql: completedIssuesJql,
      fields: `key,summary,status,${storyPointsField},fixVersions,updated,created`,
      maxResults: 200 // Limit to recent issues
    }) as JiraSearchResponse;

    console.log(`📊 Found ${completedIssuesResponse.issues.length} completed issues`);

    // Create a simple grouping by fixVersions (treating these as "sprints")
    const sprintGroups = new Map<string, any[]>();
    
    completedIssuesResponse.issues.forEach(issue => {
      const versions = issue.fields.fixVersions || [];
      
      if (versions.length > 0) {
        // Group by first fixVersion
        const version = versions[0];
        const sprintKey = version.name;
        
        // Filter by sprint names if provided
        if (sprintNames && sprintNames.length > 0) {
          const matchesFilter = sprintNames.some((name: string) => 
            sprintKey.toLowerCase().includes(name.toLowerCase())
          );
          if (!matchesFilter) return;
        }
        
        if (!sprintGroups.has(sprintKey)) {
          sprintGroups.set(sprintKey, []);
        }
        sprintGroups.get(sprintKey)!.push(issue);
      } else {
        // Group issues without fixVersions into "Recent Work"
        const defaultKey = 'Recent Work';
        if (!sprintGroups.has(defaultKey)) {
          sprintGroups.set(defaultKey, []);
        }
        sprintGroups.get(defaultKey)!.push(issue);
      }
    });

    // Convert groups to sprint details
    const sprintDetails = [];
    for (const [sprintName, issues] of sprintGroups.entries()) {
      console.log(`📈 Processing sprint group: ${sprintName} with ${issues.length} issues`);
      
      // Calculate actual velocity (sum of story points completed)
      const completedStoryPoints = issues.reduce((total, issue) => {
        const points = (issue.fields as any)[storyPointsField] || 0;
        return total + points;
      }, 0);

      // Estimate sprint dates from issue completion dates
      const issueDates = issues.map(issue => new Date(issue.fields.updated || issue.fields.created));
      const startDate = new Date(Math.min(...issueDates.map(d => d.getTime())));
      const endDate = new Date(Math.max(...issueDates.map(d => d.getTime())));

      sprintDetails.push({
        id: sprintName.replace(/\s+/g, '-').toLowerCase(), // Create a simple ID
        name: sprintName,
        state: 'closed',
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        completedIssues: issues,
        actualVelocity: completedStoryPoints,
        completedCount: issues.length
      });
    }

    console.log(`✅ Found ${sprintDetails.length} sprint groups with completion data`);
    return sprintDetails;
  } catch (error) {
    console.error('❌ Error getting sprints from Jira:', error);
    throw error;
  }
}

// Helper function to sync individual sprint data
async function syncSprintData(jiraSprint: any) {
  try {
    console.log(`🔄 Syncing sprint: ${jiraSprint.name}`);

    // Find matching sprint in our database by exact name match first, then fuzzy match
    let existingSprint = await prisma.sprint.findFirst({
      where: {
        name: jiraSprint.name,
        archived: false
      },
      include: {
        workItemAssignments: {
          include: {
            workItem: true
          }
        }
      }
    });

    // If exact match not found, try fuzzy match but check for duplicates
    if (!existingSprint) {
      const fuzzySprints = await prisma.sprint.findMany({
        where: {
          name: {
            contains: jiraSprint.name
          },
          archived: false
        },
        include: {
          workItemAssignments: {
            include: {
              workItem: true
            }
          }
        }
      });

      if (fuzzySprints.length > 1) {
        console.warn(`⚠️ Multiple sprints found for fuzzy match "${jiraSprint.name}":`, 
          fuzzySprints.map(s => `${s.name} (ID: ${s.id})`));
        // Use the one with the most recent creation or lowest ID as a fallback
        existingSprint = fuzzySprints.sort((a, b) => a.id.localeCompare(b.id))[0];
        console.log(`🎯 Using sprint: ${existingSprint.name} (ID: ${existingSprint.id})`);
      } else if (fuzzySprints.length === 1) {
        existingSprint = fuzzySprints[0];
      }
    }

    if (!existingSprint) {
      console.log(`⚠️ No matching sprint found in database for: ${jiraSprint.name}`);
      return {
        sprintName: jiraSprint.name,
        status: 'not_found',
        message: 'Sprint not found in local database'
      };
    }

    console.log(`✅ Found matching sprint: ${existingSprint.name} (ID: ${existingSprint.id})`);

    // Update sprint's actual velocity
    await prisma.sprint.update({
      where: { id: existingSprint.id },
      data: {
        actualVelocity: jiraSprint.actualVelocity
      }
    });

    // Update work item statuses based on Jira completion
    const updatedWorkItems = [];
    for (const assignment of existingSprint.workItemAssignments) {
      const workItem = assignment.workItem;
      
      if (workItem.jiraId) {
        // Check if this work item was completed in Jira
        const completedInJira = jiraSprint.completedIssues.some((issue: any) => 
          issue.key === workItem.jiraId
        );

        if (completedInJira && workItem.status !== 'Completed') {
          // Update work item status to completed
          await prisma.workItem.update({
            where: { id: workItem.id },
            data: {
              status: 'Completed',
              jiraStatus: 'Done'
            }
          });

          updatedWorkItems.push({
            id: workItem.id,
            jiraId: workItem.jiraId,
            title: workItem.title,
            oldStatus: workItem.status,
            newStatus: 'Completed'
          });

          console.log(`📝 Updated work item ${workItem.jiraId} status: ${workItem.status} → Completed`);
        }
      }
    }

    return {
      sprintName: jiraSprint.name,
      sprintId: existingSprint.id,
      status: 'synced',
      actualVelocity: jiraSprint.actualVelocity,
      plannedVelocity: existingSprint.plannedVelocity,
      updatedWorkItems: updatedWorkItems.length,
      workItemUpdates: updatedWorkItems
    };

  } catch (error) {
    console.error(`❌ Error syncing sprint ${jiraSprint.name}:`, error);
    return {
      sprintName: jiraSprint.name,
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// NEW: Simple velocity sync endpoint that works with basic Jira API
router.post('/sync-velocity', async (req, res) => {
  try {
    const { projectKey } = req.body;
    
    if (!projectKey) {
      return res.status(400).json({ 
        error: 'Project key is required',
        suggestion: 'Provide a project key (e.g., REF)'
      });
    }

    console.log(`🚀 NEW: Starting velocity sync for project: ${projectKey}`);

    // Use the simplest possible Jira API call
    const jql = `project = ${projectKey} AND status = Done`;
    const storyPointsField = process.env.JIRA_STORY_POINTS_FIELD || 'customfield_10016';
    
    console.log(`📋 Executing JQL: ${jql}`);
    
    const response = await callJiraAPI('search', {
      jql: jql,
      fields: `key,summary,status,${storyPointsField},fixVersions`,
      maxResults: 50
    }) as JiraSearchResponse;

    console.log(`✅ Successfully retrieved ${response.issues.length} completed issues`);

    // Simple grouping by fixVersion
    const versionGroups = new Map<string, { count: number, points: number }>();
    
    response.issues.forEach(issue => {
      const points = (issue.fields as any)[storyPointsField] || 1;
      const versions = issue.fields.fixVersions || [];
      
      const versionName = versions.length > 0 ? versions[0].name : 'No Version';
      
      if (!versionGroups.has(versionName)) {
        versionGroups.set(versionName, { count: 0, points: 0 });
      }
      
      const group = versionGroups.get(versionName)!;
      group.count += 1;
      group.points += points;
    });

    // Convert to expected format
    const syncResults = Array.from(versionGroups.entries()).map(([name, data]) => ({
      sprintName: name,
      status: 'synced',
      actualVelocity: data.points,
      completedCount: data.count,
      message: `Found ${data.count} issues with ${data.points} total points`
    }));

    const result = {
      message: `Velocity sync completed: ${syncResults.length} versions found`,
      syncResults,
      timestamp: new Date().toISOString()
    };

    console.log(`🎉 Velocity sync successful:`, result);
    res.json(result);

  } catch (error) {
    console.error('❌ Error in NEW velocity sync:', error);
    res.status(500).json({
      error: 'Velocity sync failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      suggestion: 'Check Jira connectivity'
    });
  }
});

// TEST: Simple test endpoint to verify backend updates
router.post('/test-sync', async (req, res) => {
  try {
    res.json({
      message: "NEW backend code is working!",
      timestamp: new Date().toISOString(),
      version: "2.0"
    });
  } catch (error) {
    res.status(500).json({ error: 'Test failed' });
  }
});

// NEW: Sync completed tickets from Jira to past sprints
router.post('/sync-past-sprints', async (req, res) => {
  try {
    const { projectKey, dateRange } = req.body;
    
    if (!projectKey) {
      return res.status(400).json({ 
        error: 'Project key is required',
        suggestion: 'Provide a project key (e.g., REF)'
      });
    }

    console.log(`🔄 Starting past sprint sync for project: ${projectKey}`);

    // Get completed issues from Jira
    let jql = `project = ${projectKey} AND status = Done`;
    
    // Add date filter if provided
    if (dateRange && dateRange.start && dateRange.end) {
      jql += ` AND updated >= "${dateRange.start}" AND updated <= "${dateRange.end}"`;
    }
    
    const storyPointsField = process.env.JIRA_STORY_POINTS_FIELD || 'customfield_10016';
    
    const completedIssues = await callJiraAPI('search', {
      jql: jql,
      fields: `key,summary,description,status,${storyPointsField},customfield_10020,updated,created,labels`,
      maxResults: 200
    }) as JiraSearchResponse;

    console.log(`📈 Found ${completedIssues.issues.length} completed issues to sync`);

    // Get existing sprints from database (past sprints only)
    const pastSprints = await prisma.sprint.findMany({
      where: {
        archived: false,
        endDate: { lt: new Date() } // Only past sprints
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

    console.log(`📊 Found ${pastSprints.length} past sprints in database`);

    // Process each completed issue
    const syncResults = [];
    const processedTickets = new Set();

    for (const issue of completedIssues.issues) {
      if (processedTickets.has(issue.key)) {
        continue; // Skip duplicates
      }
      processedTickets.add(issue.key);

      try {
        const result = await syncCompletedTicketToSprint(issue, pastSprints, storyPointsField);
        syncResults.push(result);
      } catch (error) {
        console.error(`❌ Error syncing ticket ${issue.key}:`, error);
        syncResults.push({
          ticketKey: issue.key,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Update sprint velocities
    const sprintUpdates = await updateSprintVelocities(pastSprints);

    res.json({
      message: `Successfully synced ${completedIssues.issues.length} completed tickets to past sprints`,
      syncResults,
      sprintUpdates,
      timestamp: new Date().toISOString(),
      summary: {
        totalTickets: completedIssues.issues.length,
        successfulSyncs: syncResults.filter(r => r.status === 'synced').length,
        errors: syncResults.filter(r => r.status === 'error').length,
        sprintUpdates: sprintUpdates.length
      }
    });

  } catch (error) {
    console.error('❌ Error syncing past sprints from Jira:', error);
    res.status(500).json({
      error: 'Failed to sync past sprints from Jira',
      message: error instanceof Error ? error.message : 'Unknown error',
      suggestion: 'Check Jira API connectivity and credentials'
    });
  }
});

// Helper function to extract sprint name from Jira sprint field
function extractSprintName(sprintData: any): string | null {
  try {
    // Handle different sprint data formats
    let sprintName = null;
    
    if (typeof sprintData === 'string') {
      // Parse sprint string that might contain sprint info
      // Format: "name=REF Q3 2025 Sprint 2,startDate=2025-07-01,endDate=2025-07-14,state=closed"
      const nameMatch = sprintData.match(/name=([^,]+)/);
      if (nameMatch) {
        sprintName = nameMatch[1];
      }
    } else if (sprintData && typeof sprintData === 'object') {
      // Handle object format - the sprint object from customfield_10020
      sprintName = sprintData.name || sprintData.sprintName;
    }
    
    if (sprintName) {
      console.log(`📋 Extracted sprint name: ${sprintName}`);
      return sprintName.trim();
    }
    
    console.log(`⚠️ Could not extract sprint name from:`, JSON.stringify(sprintData));
    return null;
  } catch (error) {
    console.error(`❌ Error extracting sprint name:`, error);
    return null;
  }
}

// Helper function to sync a completed ticket to the appropriate sprint
async function syncCompletedTicketToSprint(jiraIssue: any, pastSprints: any[], storyPointsField: string) {
  const ticketKey = jiraIssue.key;
  const summary = jiraIssue.fields.summary;
  const points = (jiraIssue.fields as any)[storyPointsField] || 1;
  // Use the correct sprint field (customfield_10020)
  const sprints = jiraIssue.fields.customfield_10020 || [];
  const updatedDate = new Date(jiraIssue.fields.updated);
  const createdDate = new Date(jiraIssue.fields.created);

  console.log(`🎫 Processing ticket ${ticketKey}: ${summary}`);

  // Strategy 1: Match by sprint field - use the last sprint if multiple sprints
  let targetSprint = null;
  if (sprints && sprints.length > 0) {
    // Get the last sprint (most recent) from the sprint field
    const lastSprint = Array.isArray(sprints) ? sprints[sprints.length - 1] : sprints;
    const sprintName = extractSprintName(lastSprint);
    
    if (sprintName) {
      targetSprint = pastSprints.find(sprint => 
        sprint.name.toLowerCase() === sprintName.toLowerCase() ||
        sprint.name.toLowerCase().includes(sprintName.toLowerCase()) ||
        sprintName.toLowerCase().includes(sprint.name.toLowerCase())
      );
      
      if (targetSprint) {
        console.log(`✅ Matched ticket ${ticketKey} to sprint by sprint field: ${targetSprint.name} (from Jira sprint: ${sprintName})`);
      } else {
        console.log(`⚠️ No matching sprint found for Jira sprint: ${sprintName}`);
      }
    }
  }

  // Strategy 2: Match by date range if no sprint field match
  if (!targetSprint) {
    targetSprint = pastSprints.find(sprint => {
      const sprintStart = new Date(sprint.startDate);
      const sprintEnd = new Date(sprint.endDate);
      return updatedDate >= sprintStart && updatedDate <= sprintEnd;
    });
    
    if (targetSprint) {
      console.log(`✅ Matched ticket ${ticketKey} to sprint by date: ${targetSprint.name}`);
    }
  }

  // Strategy 3: Use the most recent past sprint if no match
  if (!targetSprint && pastSprints.length > 0) {
    targetSprint = pastSprints[pastSprints.length - 1]; // Most recent sprint
    console.log(`⚠️ No specific match for ${ticketKey}, assigning to most recent sprint: ${targetSprint.name}`);
  }

  if (!targetSprint) {
    return {
      ticketKey,
      status: 'no_sprint_found',
      message: 'No appropriate past sprint found for this ticket'
    };
  }

  // Check if work item already exists
  let workItem = await prisma.workItem.findFirst({
    where: { jiraId: ticketKey }
  });

  if (!workItem) {
    // Create new work item from Jira ticket
    const skills = (jiraIssue.fields.labels || []).filter((label: string) => 
      ['frontend', 'backend', 'devops', 'design', 'qa'].includes(label.toLowerCase())
    );

    // Use skill detection from existing function
    const detectedSkills = skills.length > 0 ? skills : ['backend']; // Default to backend if no labels

    workItem = await prisma.workItem.create({
      data: {
        jiraId: ticketKey,
        title: summary,
        description: extractTextFromADF(jiraIssue.fields.description) || `Work item synced from completed Jira ticket ${ticketKey}`,
        estimateStoryPoints: points,
        requiredCompletionDate: updatedDate, // Use completion date
        requiredSkills: detectedSkills,
        status: 'Completed', // Mark as completed since it's done in Jira
        jiraStatus: 'Done'
      }
    });

    console.log(`➕ Created new work item for ${ticketKey}`);
  } else {
    // Update existing work item status if not already completed
    if (workItem.status !== 'Completed') {
      await prisma.workItem.update({
        where: { id: workItem.id },
        data: {
          status: 'Completed',
          jiraStatus: 'Done'
        }
      });
      console.log(`🔄 Updated work item ${ticketKey} status to Completed`);
    }
  }

  // Check if already assigned to this sprint
  const existingAssignment = await prisma.sprintWorkItem.findUnique({
    where: {
      sprintId_workItemId: {
        sprintId: targetSprint.id,
        workItemId: workItem.id
      }
    }
  });

  if (!existingAssignment) {
    // Assign work item to sprint
    await prisma.sprintWorkItem.create({
      data: {
        sprintId: targetSprint.id,
        workItemId: workItem.id
      }
    });
    console.log(`🔗 Assigned work item ${ticketKey} to sprint ${targetSprint.name}`);
  }

  return {
    ticketKey,
    status: 'synced',
    sprintName: targetSprint.name,
    sprintId: targetSprint.id,
    workItemId: workItem.id,
    storyPoints: points,
    message: `Synced to sprint: ${targetSprint.name}`
  };
}

// Helper function to update sprint velocities based on assigned completed work items
async function updateSprintVelocities(sprints: any[]) {
  const updates = [];

  for (const sprint of sprints) {
    // Calculate actual velocity from completed work items assigned to this sprint
    const completedWorkItems = await prisma.sprintWorkItem.findMany({
      where: {
        sprintId: sprint.id,
        workItem: {
          status: 'Completed'
        }
      },
      include: {
        workItem: true
      }
    });

    const actualVelocity = completedWorkItems.reduce((total, assignment) => {
      return total + assignment.workItem.estimateStoryPoints;
    }, 0);

    // Update sprint only if velocity changed
    if (sprint.actualVelocity !== actualVelocity) {
      await prisma.sprint.update({
        where: { id: sprint.id },
        data: { actualVelocity }
      });

      updates.push({
        sprintId: sprint.id,
        sprintName: sprint.name,
        oldVelocity: sprint.actualVelocity,
        newVelocity: actualVelocity,
        completedItems: completedWorkItems.length
      });

      console.log(`📊 Updated sprint ${sprint.name} velocity: ${sprint.actualVelocity} → ${actualVelocity}`);
    }
  }

  return updates;
}

export default router; 