import { clsx, type ClassValue } from "clsx";
import { differenceInDays, format, parseISO } from "date-fns";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(value?: Date | string | null) {
  if (!value) {
    return "Not recorded";
  }

  return format(value instanceof Date ? value : parseISO(value), "dd MMM yyyy");
}

export function getAgeInDays(value: string, referenceDate: string) {
  return differenceInDays(parseISO(referenceDate), parseISO(value));
}

export function formatAgeLabel(ageDays: number) {
  if (ageDays < 14) {
    return `${ageDays} d`;
  }

  if (ageDays < 70) {
    return `${Math.round(ageDays / 7)} wk`;
  }

  return `${(ageDays / 30.4).toFixed(1)} mo`;
}

export function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
