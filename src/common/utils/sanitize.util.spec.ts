import { plainToInstance } from 'class-transformer';
import { sanitizeText, SanitizeText } from './sanitize.util';

class TestDto {
  @SanitizeText()
  text: string;
}

describe('sanitizeText', () => {
  it('should strip script tags and their content', () => {
    const input = 'Hello <script>alert("xss")</script> World';
    const expected = 'Hello alert("xss") World';
    expect(sanitizeText(input)).toBe(expected);
  });

  it('should strip HTML tags but preserve text', () => {
    const input = '<div><b>Bold text</b> and <i>italic text</i></div>';
    const expected = 'Bold text and italic text';
    expect(sanitizeText(input)).toBe(expected);
  });

  it('should trim surrounding whitespace', () => {
    const input = '   Clean Me   ';
    const expected = 'Clean Me';
    expect(sanitizeText(input)).toBe(expected);
  });

  it('should return non-string values as-is', () => {
    expect(sanitizeText(null)).toBeNull();
    expect(sanitizeText(undefined)).toBeUndefined();
    expect(sanitizeText(123)).toBe(123);
  });
});

describe('SanitizeText Decorator', () => {
  it('should sanitize HTML inside class-transformer validation pipeline', () => {
    const plain = { text: 'Hello <script>alert(1)</script> World' };
    const instance = plainToInstance(TestDto, plain);
    expect(instance.text).toBe('Hello alert(1) World');
  });
});
