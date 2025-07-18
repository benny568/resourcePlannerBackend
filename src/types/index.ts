export type Skill = 'frontend' | 'backend';

export interface TeamMemberData {
  name: string;
  capacity: number;
  skills: Skill[];
}

export interface WorkItemData {
  title: string;
  description?: string;
  estimateStoryPoints: number;
  requiredCompletionDate: string;
  requiredSkills: Skill[];
  dependencies?: string[];
  status?: 'Not Started' | 'In Progress' | 'Completed';
  jiraId?: string | null; // Optional Jira ticket ID (e.g., REF-1234)
  jiraStatus?: string | null; // Original Jira status (e.g., "Ready for Testing", "In Review", etc.)
  epicId?: string | null; // Optional Epic ID if this work item belongs to an epic
}

export interface EpicData {
  jiraId: string; // Jira epic key (e.g., REF-1234)
  title: string;
  description?: string;
  status?: 'Not Started' | 'In Progress' | 'Completed';
  jiraStatus?: string | null; // Original Jira status
}

export interface SprintData {
  name: string;
  startDate: string;
  endDate: string;
  plannedVelocity: number;
  actualVelocity?: number;
}

export interface PersonalHolidayData {
  teamMemberId: string;
  startDate: string;
  endDate: string;
  description?: string;
}

export interface PublicHolidayData {
  name: string;
  date: string;
  impactPercentage: number;
}

export interface SprintConfigData {
  firstSprintStartDate: string;
  sprintDurationDays: number;
  defaultVelocity: number;
}

// Extended response types for API responses
export interface WorkItemResponse {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  description: string | null;
  title: string;
  estimateStoryPoints: number;
  requiredCompletionDate: Date;
  requiredSkills: any;
  status: string;
  dependencies: string[];
  assignedSprints: string[];
  jiraId?: string | null; // Optional Jira ticket ID (e.g., REF-1234)
  jiraStatus?: string | null; // Original Jira status (e.g., "Ready for Testing", "In Review", etc.)
}

export interface SprintResponse {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  startDate: Date;
  endDate: Date;
  plannedVelocity: number;
  actualVelocity: number | null;
  workItems: string[];
}

export interface EpicResponse {
  id: string;
  jiraId: string;
  title: string;
  description: string | null;
  status: string;
  jiraStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
  children: WorkItemResponse[];
  totalStoryPoints: number;
  completedStoryPoints: number;
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface ApiError {
  error: string;
  message?: string;
  details?: any;
} 