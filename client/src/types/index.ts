export type UserRole = 'user' | 'admin' | 'superadmin' | 'owner';

export type UserStatus = 'active' | 'inactive' | 'blocked';

export type NotificationPriority = 'normal' | 'important' | 'urgent';

export type RecurrenceType = 'none' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface User {
  id: string;
  username?: string;
  name: string;
  email?: string;
  role: UserRole;
  status?: UserStatus;
  groups?: string[];
  tenantId?: number | null;
  createdAt?: number;
  lastLogin?: number;
}

export interface Group {
  id: string;
  name: string;
  description?: string;
  userIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Notification {
  id: string;
  title: string;
  content: string;
  priority: NotificationPriority;
  createdBy: string;
  createdAt: number;
  scheduledFor?: number;
  recurrence?: RecurrenceType;
  targetType: 'all' | 'groups' | 'users';
  targetIds?: string[];
}

export interface Delivery {
  id: string;
  notificationId: string;
  userId: string;
  deliveredAt: number;
  readAt?: number;
  isRead: boolean;
}

export interface Schedule {
  id: string;
  notificationId?: string;
  title: string;
  content?: string;
  priority?: NotificationPriority;
  scheduledFor: number;
  recurrence: RecurrenceType;
  isActive: boolean;
  lastRun?: number;
  nextRun?: number;
}

export interface PasswordRequest {
  id: string;
  userId: string;
  username: string;
  requestedAt: number;
  resolvedAt?: number;
  resolvedBy?: string;
  status: 'pending' | 'resolved';
}

export interface AdminLog {
  id: string;
  adminId: string;
  action: string;
  targetType: 'user' | 'group' | 'notification' | 'system';
  targetId?: string;
  details: string;
  timestamp: number;
}

export interface Tenant {
  id: number;
  name: string;
  slug: string;
  ownerId?: number;
  status: 'active' | 'suspended' | 'expired';
  plan: 'basic' | 'pro' | 'enterprise';
  subscriptionExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
