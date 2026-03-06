import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateInviteCode(length: number = 6): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function calculateLevel(xp: number): number {
  // Simple level logic: Level 1 = 0xp, Level 2 = 100xp, Level 3 = 300xp, etc.
  // Formula: 100 * (level - 1)^2
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

export function getXpForLevel(level: number): number {
  return 100 * Math.pow(level - 1, 2);
}
