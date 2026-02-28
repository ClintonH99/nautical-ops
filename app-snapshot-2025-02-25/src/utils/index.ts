/**
 * Utility Functions
 */

/**
 * Calculate task priority based on time remaining
 * @param deadline - Task deadline as ISO string
 * @param timeframe - Original timeframe of the task
 * @returns Priority level: GREEN, YELLOW, RED, or OVERDUE
 */
export const calculateTaskPriority = (deadline: string): string => {
  const now = new Date();
  const deadlineDate = new Date(deadline);
  const timeRemaining = deadlineDate.getTime() - now.getTime();

  // If past deadline
  if (timeRemaining < 0) {
    return 'OVERDUE';
  }

  // Calculate percentage of time remaining
  // For this, we'd need to know the original deadline vs current time
  // Simplified version: use hours remaining
  const hoursRemaining = timeRemaining / (1000 * 60 * 60);

  // Green: 70-100% time remaining (more than 2 days)
  if (hoursRemaining > 48) {
    return 'GREEN';
  }
  // Yellow: 30-70% time remaining (1-2 days)
  else if (hoursRemaining > 24) {
    return 'YELLOW';
  }
  // Red: 0-30% time remaining (less than 1 day)
  else {
    return 'RED';
  }
};

/**
 * Parse a YYYY-MM-DD date string as local date (avoids UTC midnight shifting to previous day).
 */
export const parseLocalDate = (dateStr: string): Date => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
};

/**
 * Format a YYYY-MM-DD string for display using local date (no timezone shift).
 */
export const formatLocalDateString = (
  dateStr: string,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
): string => parseLocalDate(dateStr).toLocaleDateString(undefined, options);

/**
 * Format date to readable string
 */
export const formatDate = (date: string | Date): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

/**
 * Format date and time
 */
export const formatDateTime = (date: string | Date): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Get time remaining in human-readable format
 */
export const getTimeRemaining = (deadline: string): string => {
  const now = new Date();
  const deadlineDate = new Date(deadline);
  const diff = deadlineDate.getTime() - now.getTime();

  if (diff < 0) {
    const days = Math.floor(Math.abs(diff) / (1000 * 60 * 60 * 24));
    return `Overdue by ${days} day${days !== 1 ? 's' : ''}`;
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (days > 0) {
    return `${days} day${days !== 1 ? 's' : ''} ${hours} hour${hours !== 1 ? 's' : ''} remaining`;
  } else {
    return `${hours} hour${hours !== 1 ? 's' : ''} remaining`;
  }
};

/**
 * Validate email format
 */
export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};
