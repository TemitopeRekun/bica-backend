import { Transform } from 'class-transformer';
import sanitizeHtml from 'sanitize-html';

/**
 * Strips all HTML tags and attributes from a plain text input.
 * Trims leading/trailing whitespace.
 */
export function sanitizeText(value: any): any {
  if (typeof value !== 'string') {
    return value;
  }
  return sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {},
  }).trim();
}

/**
 * Reusable class-transformer decorator to sanitize user-controlled text inputs.
 */
export function SanitizeText() {
  return Transform(({ value }) => sanitizeText(value));
}
