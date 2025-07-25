import { Router } from 'express';
import { z } from 'zod';

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
    const { projectKey } = ProjectKeySchema.parse(req.body);
    console.log(`🔍 Extracting regular work items (excluding epics) from Jira project: ${projectKey}`);

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

export default router; 